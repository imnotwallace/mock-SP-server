# Plan 07: File Versioning

## Overview

Implement file version history tracking, allowing clients to list previous versions and download specific version content.

## References

- [List versions](https://learn.microsoft.com/en-us/graph/api/driveitem-list-versions?view=graph-rest-1.0)
- [Get driveItemVersion](https://learn.microsoft.com/en-us/graph/api/driveitemversion-get?view=graph-rest-1.0)
- [Get version content](https://learn.microsoft.com/en-us/graph/api/driveitemversion-get-contents?view=graph-rest-1.0)
- [Restore version](https://learn.microsoft.com/en-us/graph/api/driveitemversion-restore?view=graph-rest-1.0)

## Current State

- Files are overwritten on update
- No version history tracked
- No version-related endpoints

## API Specifications

### List Versions

**Endpoint:** `GET /drives/{driveId}/items/{itemId}/versions`

**Response:**
```json
{
  "@odata.context": "...",
  "value": [
    {
      "id": "1.0",
      "lastModifiedDateTime": "2024-01-15T10:30:00Z",
      "lastModifiedBy": {
        "user": {
          "displayName": "John Doe",
          "email": "john@contoso.com"
        }
      },
      "size": 12345
    },
    {
      "id": "2.0",
      "lastModifiedDateTime": "2024-01-16T14:45:00Z",
      "lastModifiedBy": {
        "user": {
          "displayName": "Jane Smith"
        }
      },
      "size": 15678
    }
  ]
}
```

### Get Version

**Endpoint:** `GET /drives/{driveId}/items/{itemId}/versions/{versionId}`

### Get Version Content

**Endpoint:** `GET /drives/{driveId}/items/{itemId}/versions/{versionId}/content`

**Response:** File content with appropriate Content-Type

### Restore Version

**Endpoint:** `POST /drives/{driveId}/items/{itemId}/versions/{versionId}/restoreVersion`

**Response:** `204 No Content` (the current version is now a copy of the restored version)

## Implementation Steps

### Step 1: Create Versions Schema

Update `src/services/database.ts`:

```sql
CREATE TABLE IF NOT EXISTS versions (
  id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  version_number TEXT NOT NULL,  -- "1.0", "2.0", etc.
  content_path TEXT NOT NULL,    -- Path to versioned content
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by_id TEXT,
  created_by_email TEXT,
  created_by_display_name TEXT,
  PRIMARY KEY (item_id, id),
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX idx_versions_item ON versions(item_id);
```

### Step 2: Create Versions Storage Directory

Version content stored alongside originals:

```
data/
  contoso/
    main/
      Documents/
        file.docx           <- Current version
        .versions/
          file.docx/
            1.0             <- Version 1 content
            2.0             <- Version 2 content
```

### Step 3: Create Version Service

Create `src/services/versions.ts`:

```typescript
import * as path from 'path';
import * as fs from 'fs/promises';

export interface DriveItemVersion {
  id: string;
  lastModifiedDateTime: string;
  lastModifiedBy: {
    user: {
      id?: string;
      displayName?: string;
      email?: string;
    };
  };
  size: number;
}

export class VersionsService {
  constructor(
    private db: DatabaseService,
    private fsService: FilesystemService
  ) {}

  async listVersions(itemId: string): Promise<DriveItemVersion[]> {
    const item = await this.db.getItem(itemId);
    if (!item || item.type !== 'file') {
      throw GraphError.notFound('File not found');
    }

    const versions = this.db.prepare(`
      SELECT * FROM versions
      WHERE item_id = ?
      ORDER BY created_at DESC
    `).all(itemId);

    return versions.map(v => this.formatVersion(v));
  }

  async getVersion(itemId: string, versionId: string): Promise<DriveItemVersion | null> {
    const version = this.db.prepare(`
      SELECT * FROM versions
      WHERE item_id = ? AND id = ?
    `).get(itemId, versionId);

    if (!version) return null;

    return this.formatVersion(version);
  }

  async getVersionContent(itemId: string, versionId: string): Promise<Buffer> {
    const version = this.db.prepare(`
      SELECT content_path FROM versions
      WHERE item_id = ? AND id = ?
    `).get(itemId, versionId);

    if (!version) {
      throw GraphError.notFound('Version not found');
    }

    return this.fsService.readFile(version.content_path);
  }

  async createVersion(
    itemId: string,
    currentContent: Buffer,
    modifiedBy?: { id?: string; email?: string; displayName?: string }
  ): Promise<void> {
    const item = await this.db.getItem(itemId);
    if (!item) return;

    // Get next version number
    const lastVersion = this.db.prepare(`
      SELECT version_number FROM versions
      WHERE item_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(itemId);

    const nextVersionNum = lastVersion
      ? `${parseInt(lastVersion.version_number) + 1}.0`
      : '1.0';

    // Store version content
    const versionDir = this.getVersionsDir(item.path);
    const versionPath = path.join(versionDir, nextVersionNum);
    await this.fsService.writeFile(versionPath, currentContent);

    // Record in database
    const versionId = generateId();
    this.db.prepare(`
      INSERT INTO versions (
        id, item_id, version_number, content_path, size,
        created_at, created_by_id, created_by_email, created_by_display_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      itemId,
      nextVersionNum,
      versionPath,
      currentContent.length,
      new Date().toISOString(),
      modifiedBy?.id,
      modifiedBy?.email,
      modifiedBy?.displayName
    );
  }

  async restoreVersion(itemId: string, versionId: string): Promise<void> {
    const item = await this.db.getItem(itemId);
    if (!item) {
      throw GraphError.notFound('Item not found');
    }

    const version = await this.getVersion(itemId, versionId);
    if (!version) {
      throw GraphError.notFound('Version not found');
    }

    // Get current content (to save as new version)
    const currentContent = await this.fsService.readFile(item.path);

    // Get version content
    const versionContent = await this.getVersionContent(itemId, versionId);

    // Create new version from current content
    await this.createVersion(itemId, currentContent, {
      displayName: 'System (Restore)'
    });

    // Overwrite current file with version content
    await this.fsService.writeFile(item.path, versionContent);

    // Update item metadata
    await this.db.updateItem(itemId, {
      size: versionContent.length,
      modifiedAt: new Date().toISOString()
    });
  }

  async deleteVersion(itemId: string, versionId: string): Promise<void> {
    const version = this.db.prepare(`
      SELECT content_path FROM versions
      WHERE item_id = ? AND id = ?
    `).get(itemId, versionId);

    if (!version) {
      throw GraphError.notFound('Version not found');
    }

    // Delete version file
    await this.fsService.deleteFile(version.content_path);

    // Remove from database
    this.db.prepare(`
      DELETE FROM versions WHERE item_id = ? AND id = ?
    `).run(itemId, versionId);
  }

  private getVersionsDir(itemPath: string): string {
    const dir = path.dirname(itemPath);
    const name = path.basename(itemPath);
    return path.join(dir, '.versions', name);
  }

  private formatVersion(dbRow: any): DriveItemVersion {
    return {
      id: dbRow.version_number,
      lastModifiedDateTime: dbRow.created_at,
      lastModifiedBy: {
        user: {
          id: dbRow.created_by_id,
          displayName: dbRow.created_by_display_name,
          email: dbRow.created_by_email
        }
      },
      size: dbRow.size
    };
  }
}
```

### Step 4: Integrate with File Updates

Modify file update to create versions:

```typescript
// In drives.ts - PUT /drives/:driveId/items/:itemId/content
router.put('/:driveId/items/:itemId/content', async (req, res) => {
  const { driveId, itemId } = req.params;

  const item = await db.getItem(itemId);
  if (!item) {
    throw GraphError.notFound('Item not found');
  }

  // Save current content as version before overwriting
  if (item.type === 'file') {
    try {
      const currentContent = await fsService.readFile(item.path);
      await versionsService.createVersion(
        itemId,
        currentContent,
        req.user  // If auth provides user context
      );
    } catch (error) {
      // File might not exist yet, ignore
    }
  }

  // Write new content
  const newContent = req.body;
  await fsService.writeFile(item.path, newContent);

  // Update item metadata
  await db.updateItem(itemId, {
    size: newContent.length,
    modifiedAt: new Date().toISOString()
  });

  const updatedItem = await db.getItem(itemId);
  res.json(formatDriveItem(updatedItem));
});
```

### Step 5: Add Version Endpoints

Add to `src/routes/drives.ts`:

```typescript
const versionsService = new VersionsService(db, fsService);

// GET /drives/:driveId/items/:itemId/versions
router.get('/:driveId/items/:itemId/versions', async (req, res) => {
  const { itemId } = req.params;
  const odataParams = req.odataParams;

  const versions = await versionsService.listVersions(itemId);

  // Apply pagination
  const paginated = applyPagination(versions, odataParams);

  res.json(formatPaginatedResponse(paginated, versions.length, req, odataParams));
});

// GET /drives/:driveId/items/:itemId/versions/:versionId
router.get('/:driveId/items/:itemId/versions/:versionId', async (req, res) => {
  const { itemId, versionId } = req.params;

  const version = await versionsService.getVersion(itemId, versionId);
  if (!version) {
    throw GraphError.notFound('Version not found');
  }

  res.json(version);
});

// GET /drives/:driveId/items/:itemId/versions/:versionId/content
router.get('/:driveId/items/:itemId/versions/:versionId/content', async (req, res) => {
  const { itemId, versionId } = req.params;

  const item = await db.getItem(itemId);
  if (!item) {
    throw GraphError.notFound('Item not found');
  }

  const content = await versionsService.getVersionContent(itemId, versionId);

  res.setHeader('Content-Type', getMimeType(item.name));
  res.setHeader('Content-Disposition', `attachment; filename="${item.name}"`);
  res.send(content);
});

// POST /drives/:driveId/items/:itemId/versions/:versionId/restoreVersion
router.post('/:driveId/items/:itemId/versions/:versionId/restoreVersion', async (req, res) => {
  const { itemId, versionId } = req.params;

  await versionsService.restoreVersion(itemId, versionId);

  res.status(204).end();
});

// DELETE /drives/:driveId/items/:itemId/versions/:versionId
router.delete('/:driveId/items/:itemId/versions/:versionId', async (req, res) => {
  const { itemId, versionId } = req.params;

  await versionsService.deleteVersion(itemId, versionId);

  res.status(204).end();
});
```

### Step 6: Configure Version Limits

Add version configuration:

```typescript
// In config/types.ts
interface Config {
  // ...existing
  versioning: {
    enabled: boolean;
    maxVersions: number;  // e.g., 500
    keepMajorVersions: number;  // e.g., 100
  };
}
```

Implement cleanup when max is reached:

```typescript
async function cleanupOldVersions(itemId: string, maxVersions: number): Promise<void> {
  const versions = await db.prepare(`
    SELECT id, content_path FROM versions
    WHERE item_id = ?
    ORDER BY created_at DESC
  `).all(itemId);

  if (versions.length > maxVersions) {
    const toDelete = versions.slice(maxVersions);
    for (const v of toDelete) {
      await fsService.deleteFile(v.content_path);
      db.prepare('DELETE FROM versions WHERE id = ?').run(v.id);
    }
  }
}
```

## Test Cases

```typescript
describe('Versioning API', () => {
  describe('GET /drives/{id}/items/{id}/versions', () => {
    test('returns empty array for new file', async () => {
      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/items/${newFileId}/versions`);

      expect(response.status).toBe(200);
      expect(response.body.value).toHaveLength(0);
    });

    test('returns versions after updates', async () => {
      // Update file twice
      await updateFile(itemId, 'content v1');
      await updateFile(itemId, 'content v2');

      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/items/${itemId}/versions`);

      expect(response.body.value).toHaveLength(2);
      expect(response.body.value[0].id).toBe('2.0');
    });
  });

  describe('GET /drives/{id}/items/{id}/versions/{id}/content', () => {
    test('downloads specific version content', async () => {
      await updateFile(itemId, 'content v1');
      await updateFile(itemId, 'content v2');

      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/items/${itemId}/versions/1.0/content`);

      expect(response.status).toBe(200);
      expect(response.text).toBe('content v1');
    });
  });

  describe('POST /drives/{id}/items/{id}/versions/{id}/restoreVersion', () => {
    test('restores previous version', async () => {
      await updateFile(itemId, 'content v1');
      await updateFile(itemId, 'content v2');

      // Restore v1
      await request(app)
        .post(`/v1.0/drives/${driveId}/items/${itemId}/versions/1.0/restoreVersion`);

      // Current content should be v1
      const content = await request(app)
        .get(`/v1.0/drives/${driveId}/items/${itemId}/content`);

      expect(content.text).toBe('content v1');

      // Should have 3 versions now (v1, v2, v3 from restore)
      const versions = await request(app)
        .get(`/v1.0/drives/${driveId}/items/${itemId}/versions`);

      expect(versions.body.value).toHaveLength(3);
    });
  });

  describe('DELETE /drives/{id}/items/{id}/versions/{id}', () => {
    test('deletes specific version', async () => {
      await updateFile(itemId, 'content v1');

      const response = await request(app)
        .delete(`/v1.0/drives/${driveId}/items/${itemId}/versions/1.0`);

      expect(response.status).toBe(204);

      // Version should be gone
      const check = await request(app)
        .get(`/v1.0/drives/${driveId}/items/${itemId}/versions/1.0`);
      expect(check.status).toBe(404);
    });
  });
});
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/services/versions.ts` | Create - Version management |
| `src/services/database.ts` | Modify - Add versions table |
| `src/routes/drives.ts` | Modify - Add version endpoints |
| `src/config/types.ts` | Modify - Add versioning config |
| `tests/routes/versions.test.ts` | Create - Version tests |

## Limitations

- No minor/major version distinction (SharePoint has both)
- No check-in/check-out workflow
- Simple version numbering (1.0, 2.0, etc.)
- No version comments/labels
- .versions directory visible in filesystem (could hide with dot prefix)

## Success Criteria

1. List versions returns version history
2. Get version returns specific version metadata
3. Download version content works
4. Restore version creates new current version
5. Delete version removes version file and record
6. File updates automatically create versions
7. Version limit cleanup works
