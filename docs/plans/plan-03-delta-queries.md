# Plan 03: Delta Queries

## Overview

Implement delta query support to track changes in drive items over time. This enables efficient sync scenarios where clients only fetch changed items.

## References

- [driveItem: delta](https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0)
- [Delta query overview](https://learn.microsoft.com/en-us/graph/delta-query-overview)
- [Best practices for scale](https://learn.microsoft.com/en-us/onedrive/developer/rest-api/concepts/scan-guidance?view=odsp-graph-online)

## Current State

- No change tracking exists
- Database has items table but no change log
- No delta endpoint implemented

## API Specification

### Initial Delta Request

**Endpoint:** `GET /drives/{driveId}/root/delta`

**Response:**
```json
{
  "@odata.context": "...",
  "@odata.nextLink": "https://...?$skiptoken=...",
  "value": [
    { "id": "...", "name": "file1.txt", ... },
    { "id": "...", "name": "folder1", "folder": { "childCount": 5 }, ... }
  ]
}
```

### Paginated Response

When there are more items, response includes `@odata.nextLink`. Continue calling until you receive `@odata.deltaLink`.

### Final Page with Delta Link

```json
{
  "@odata.context": "...",
  "@odata.deltaLink": "https://...?token=...",
  "value": [
    { "id": "...", "name": "lastFile.txt", ... }
  ]
}
```

### Subsequent Delta Request

**Endpoint:** `GET /drives/{driveId}/root/delta?token={token}`

**Response:** Only items that changed since the token was issued.

### Deleted Items

Deleted items appear with a `deleted` facet:
```json
{
  "id": "deleted-item-id",
  "deleted": {
    "state": "deleted"
  }
}
```

## Implementation Steps

### Step 1: Add Change Tracking Schema

Update `src/services/database.ts`:

```sql
-- Add change token column to items
ALTER TABLE items ADD COLUMN change_token TEXT;

-- Create change log table
CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  drive_id TEXT NOT NULL,
  change_type TEXT NOT NULL,  -- 'created', 'modified', 'deleted'
  change_token TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  item_snapshot TEXT  -- JSON snapshot for deleted items
);

CREATE INDEX idx_change_log_drive_token ON change_log(drive_id, change_token);
CREATE INDEX idx_change_log_timestamp ON change_log(timestamp);

-- Token tracking table
CREATE TABLE IF NOT EXISTS delta_tokens (
  token TEXT PRIMARY KEY,
  drive_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_change_id INTEGER NOT NULL
);
```

### Step 2: Implement Change Tracking

Add change logging to all item mutations:

```typescript
// In database.ts
class DatabaseService {
  private changeCounter = 0;

  private generateChangeToken(): string {
    this.changeCounter++;
    return `${Date.now()}-${this.changeCounter}`;
  }

  async logChange(
    itemId: string,
    driveId: string,
    changeType: 'created' | 'modified' | 'deleted',
    itemSnapshot?: object
  ): Promise<string> {
    const token = this.generateChangeToken();
    const stmt = this.db.prepare(`
      INSERT INTO change_log (item_id, drive_id, change_type, change_token, timestamp, item_snapshot)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      itemId,
      driveId,
      changeType,
      token,
      new Date().toISOString(),
      itemSnapshot ? JSON.stringify(itemSnapshot) : null
    );

    // Update item's change token
    if (changeType !== 'deleted') {
      this.db.prepare('UPDATE items SET change_token = ? WHERE id = ?')
        .run(token, itemId);
    }

    return token;
  }

  // Modify existing methods to log changes
  async createItem(item: CreateItemParams): Promise<DbItem> {
    // ... existing create logic ...
    await this.logChange(item.id, driveId, 'created');
    return result;
  }

  async updateItem(id: string, updates: UpdateItemParams): Promise<void> {
    // ... existing update logic ...
    await this.logChange(id, driveId, 'modified');
  }

  async deleteItem(id: string): Promise<void> {
    const item = await this.getItem(id);
    // ... existing delete logic ...
    await this.logChange(id, driveId, 'deleted', item);
  }
}
```

### Step 3: Implement Delta Endpoint

Add to `src/routes/drives.ts`:

```typescript
// GET /drives/:driveId/root/delta
router.get('/:driveId/root/delta', async (req, res) => {
  const { driveId } = req.params;
  const token = req.query.token as string;
  const pageSize = Math.min(parseInt(req.query.$top as string) || 200, 200);

  // Validate drive exists
  const drive = await db.getDrive(driveId);
  if (!drive) {
    throw GraphError.notFound('Drive not found');
  }

  let items: DeltaItem[];
  let nextPageToken: string | null = null;
  let deltaToken: string | null = null;

  if (!token || token === 'latest') {
    // Initial sync - return all items
    const result = await getDeltaInitial(driveId, pageSize, req.query.$skiptoken);
    items = result.items;
    nextPageToken = result.nextPageToken;
    deltaToken = result.deltaToken;
  } else {
    // Incremental sync - return changes since token
    const result = await getDeltaIncremental(driveId, token, pageSize, req.query.$skiptoken);
    items = result.items;
    nextPageToken = result.nextPageToken;
    deltaToken = result.deltaToken;
  }

  const response: any = {
    '@odata.context': `${req.baseUrl}/$metadata#drives('${driveId}')/root/delta`,
    value: items.map(formatDriveItemForDelta)
  };

  if (nextPageToken) {
    response['@odata.nextLink'] =
      `${req.protocol}://${req.get('host')}/v1.0/drives/${driveId}/root/delta?$skiptoken=${nextPageToken}`;
  } else if (deltaToken) {
    response['@odata.deltaLink'] =
      `${req.protocol}://${req.get('host')}/v1.0/drives/${driveId}/root/delta?token=${deltaToken}`;
  }

  res.json(response);
});

// Also support item-level delta
// GET /drives/:driveId/items/:itemId/delta
router.get('/:driveId/items/:itemId/delta', async (req, res) => {
  // Similar logic but scoped to folder and descendants
});
```

### Step 4: Implement Delta Query Logic

```typescript
interface DeltaResult {
  items: DeltaItem[];
  nextPageToken: string | null;
  deltaToken: string | null;
}

async function getDeltaInitial(
  driveId: string,
  pageSize: number,
  skipToken?: string
): Promise<DeltaResult> {
  const offset = skipToken ? parseInt(skipToken) : 0;

  // Get all items in drive
  const items = await db.getItemsByDrive(driveId, pageSize + 1, offset);

  const hasMore = items.length > pageSize;
  if (hasMore) items.pop();

  if (hasMore) {
    return {
      items,
      nextPageToken: String(offset + pageSize),
      deltaToken: null
    };
  } else {
    // Last page - generate delta token
    const latestChange = await db.getLatestChangeId(driveId);
    const deltaToken = generateDeltaToken(driveId, latestChange);
    await db.saveDeltaToken(deltaToken, driveId, latestChange);

    return {
      items,
      nextPageToken: null,
      deltaToken
    };
  }
}

async function getDeltaIncremental(
  driveId: string,
  token: string,
  pageSize: number,
  skipToken?: string
): Promise<DeltaResult> {
  // Validate token
  const tokenRecord = await db.getDeltaToken(token);
  if (!tokenRecord || tokenRecord.driveId !== driveId) {
    throw GraphError.badRequest('Invalid or expired delta token');
  }

  const offset = skipToken ? parseInt(skipToken) : 0;

  // Get changes since token was issued
  const changes = await db.getChangesSince(
    driveId,
    tokenRecord.lastChangeId,
    pageSize + 1,
    offset
  );

  const hasMore = changes.length > pageSize;
  if (hasMore) changes.pop();

  // Convert changes to delta items
  const items = changes.map(change => {
    if (change.changeType === 'deleted') {
      return {
        id: change.itemId,
        deleted: { state: 'deleted' }
      };
    } else {
      return db.getItem(change.itemId);
    }
  }).filter(Boolean);

  if (hasMore) {
    return {
      items,
      nextPageToken: String(offset + pageSize),
      deltaToken: null
    };
  } else {
    const latestChange = await db.getLatestChangeId(driveId);
    const newDeltaToken = generateDeltaToken(driveId, latestChange);
    await db.saveDeltaToken(newDeltaToken, driveId, latestChange);

    return {
      items,
      nextPageToken: null,
      deltaToken: newDeltaToken
    };
  }
}

function generateDeltaToken(driveId: string, changeId: number): string {
  return Buffer.from(`${driveId}:${changeId}:${Date.now()}`).toString('base64url');
}
```

### Step 5: Handle Deleted Items

Ensure deleted items are properly tracked:

```typescript
function formatDriveItemForDelta(item: DeltaItem): object {
  if (item.deleted) {
    return {
      id: item.id,
      deleted: { state: 'deleted' }
    };
  }

  return formatDriveItem(item);
}
```

### Step 6: Add Hierarchical Sharing Header Support

Support the `Prefer: hierarchicalsharing` header for permission change optimization:

```typescript
router.get('/:driveId/root/delta', async (req, res) => {
  const preferHierarchicalSharing =
    req.get('Prefer')?.includes('hierarchicalsharing');

  // ... rest of delta logic ...

  if (preferHierarchicalSharing) {
    // Include sharing info only for items with explicit sharing changes
    items = items.map(item => {
      if (item.sharingChanged) {
        return { ...item, permissions: item.permissions };
      }
      return item;
    });
  }
});
```

## Test Cases

```typescript
describe('Delta queries', () => {
  describe('Initial sync', () => {
    test('GET /drives/{id}/root/delta returns all items', async () => {
      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/root/delta`);

      expect(response.status).toBe(200);
      expect(response.body.value).toBeInstanceOf(Array);
      expect(response.body).toHaveProperty('@odata.deltaLink');
    });

    test('Pagination works with @odata.nextLink', async () => {
      // Create many items, verify pagination
      const response1 = await request(app)
        .get(`/v1.0/drives/${driveId}/root/delta?$top=5`);

      expect(response1.body['@odata.nextLink']).toBeDefined();

      // Follow nextLink
      const nextUrl = new URL(response1.body['@odata.nextLink']);
      const response2 = await request(app).get(nextUrl.pathname + nextUrl.search);

      expect(response2.status).toBe(200);
    });
  });

  describe('Incremental sync', () => {
    test('Returns only changed items since token', async () => {
      // Initial sync
      const initial = await request(app)
        .get(`/v1.0/drives/${driveId}/root/delta`);
      const deltaLink = initial.body['@odata.deltaLink'];

      // Make a change
      await createFile(driveId, 'new-file.txt');

      // Delta sync
      const delta = await request(app).get(deltaLink);

      expect(delta.body.value).toHaveLength(1);
      expect(delta.body.value[0].name).toBe('new-file.txt');
    });

    test('Deleted items have deleted facet', async () => {
      const initial = await request(app)
        .get(`/v1.0/drives/${driveId}/root/delta`);
      const deltaLink = initial.body['@odata.deltaLink'];

      // Delete an item
      await deleteFile(driveId, fileId);

      // Delta sync
      const delta = await request(app).get(deltaLink);

      const deletedItem = delta.body.value.find(i => i.id === fileId);
      expect(deletedItem.deleted).toEqual({ state: 'deleted' });
    });
  });

  describe('Token handling', () => {
    test('token=latest starts fresh sync', async () => {
      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/root/delta?token=latest`);

      expect(response.status).toBe(200);
      // Should return all items like initial sync
    });

    test('Invalid token returns 400', async () => {
      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/root/delta?token=invalid`);

      expect(response.status).toBe(400);
    });
  });
});
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/services/database.ts` | Modify - Add change_log table, tracking methods |
| `src/routes/drives.ts` | Modify - Add delta endpoint |
| `src/types/delta.ts` | Create - Delta-specific types |
| `tests/routes/delta.test.ts` | Create - Delta query tests |

## Limitations

- No support for `$select` or `$expand` in delta queries
- Change log grows unbounded (would need cleanup in production)
- No support for timestamp-based tokens (`token=2024-01-15T00:00:00Z`)
- No change notification integration (that's Plan 10)

## Success Criteria

1. Initial delta returns all items with deltaLink
2. Incremental delta returns only changes
3. Deleted items appear with deleted facet
4. Pagination with nextLink works correctly
5. Invalid tokens return proper errors
6. All item mutations are tracked in change log
