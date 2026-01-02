# Plan 04: @odata.nextLink Pagination

## Overview

Implement proper `@odata.nextLink` pagination for large result sets. Currently `$top` and `$skip` are supported, but the server doesn't return nextLink for automatic client pagination.

## References

- [Microsoft Graph: Paging](https://learn.microsoft.com/en-us/graph/paging)
- [OData query parameters](https://learn.microsoft.com/en-us/graph/query-parameters)

## Current State

- `$top` limits results correctly
- `$skip` offsets results correctly
- No `@odata.nextLink` is returned when more results exist
- No `@odata.count` support
- Clients must manually calculate skip values

## API Specification

### Response with More Results

When there are more items than the page size:

```json
{
  "@odata.context": "...",
  "@odata.count": 150,
  "@odata.nextLink": "https://graph.microsoft.com/v1.0/drives/{id}/root/children?$skiptoken=eyJ0...",
  "value": [
    { ... },
    { ... }
  ]
}
```

### Final Page Response

When all items have been returned:

```json
{
  "@odata.context": "...",
  "@odata.count": 150,
  "value": [
    { ... }
  ]
}
```

No `@odata.nextLink` on the final page.

## Implementation Steps

### Step 1: Define Pagination Constants

Add to `src/config/types.ts`:

```typescript
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 100,
  MAX_PAGE_SIZE: 200,
  SHAREPOINT_MAX_PAGE_SIZE: 5000  // For list items
};
```

### Step 2: Create Skiptoken Utilities

Create `src/utils/skiptoken.ts`:

```typescript
interface SkipTokenPayload {
  skip: number;
  orderBy?: string;
  filter?: string;
  top?: number;
}

export function encodeSkipToken(payload: SkipTokenPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeSkipToken(token: string): SkipTokenPayload | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function generateNextLink(
  baseUrl: string,
  path: string,
  currentSkip: number,
  pageSize: number,
  queryParams: Record<string, string>
): string {
  const nextPayload: SkipTokenPayload = {
    skip: currentSkip + pageSize,
    top: pageSize,
    ...queryParams
  };

  const skiptoken = encodeSkipToken(nextPayload);
  return `${baseUrl}${path}?$skiptoken=${skiptoken}`;
}
```

### Step 3: Update OData Middleware

Modify `src/middleware/odata.ts`:

```typescript
export interface ODataParams {
  select?: string[];
  expand?: string[];
  filter?: string;
  orderBy?: string;
  top?: number;
  skip?: number;
  count?: boolean;
  search?: string;
  skiptoken?: string;  // Add skiptoken
}

export function parseODataQuery(req: Request): ODataParams {
  const query = req.query;

  // Handle skiptoken - decode and apply
  let skip = parseInt(query.$skip as string) || 0;
  let top = parseInt(query.$top as string) || PAGINATION.DEFAULT_PAGE_SIZE;

  if (query.$skiptoken) {
    const tokenPayload = decodeSkipToken(query.$skiptoken as string);
    if (tokenPayload) {
      skip = tokenPayload.skip;
      top = tokenPayload.top || top;
    }
  }

  // Cap top at maximum
  top = Math.min(top, PAGINATION.MAX_PAGE_SIZE);

  return {
    select: parseSelect(query.$select as string),
    expand: parseExpand(query.$expand as string),
    filter: query.$filter as string,
    orderBy: query.$orderby as string,
    top,
    skip,
    count: query.$count === 'true',
    search: query.$search as string,
    skiptoken: query.$skiptoken as string
  };
}
```

### Step 4: Create Pagination Response Helper

Add to `src/middleware/odata.ts`:

```typescript
export interface PaginatedResponse<T> {
  '@odata.context'?: string;
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
  value: T[];
}

export function formatPaginatedResponse<T>(
  items: T[],
  totalCount: number,
  req: Request,
  odataParams: ODataParams
): PaginatedResponse<T> {
  const { top, skip, count } = odataParams;
  const hasMore = skip + items.length < totalCount;

  const response: PaginatedResponse<T> = {
    '@odata.context': `${req.protocol}://${req.get('host')}${req.baseUrl}/$metadata`,
    value: items
  };

  // Include count if requested
  if (count) {
    response['@odata.count'] = totalCount;
  }

  // Include nextLink if more results exist
  if (hasMore) {
    response['@odata.nextLink'] = generateNextLink(
      `${req.protocol}://${req.get('host')}`,
      req.path,
      skip,
      top,
      {
        filter: odataParams.filter,
        orderBy: odataParams.orderBy,
        select: odataParams.select?.join(','),
        expand: odataParams.expand?.join(',')
      }
    );
  }

  return response;
}
```

### Step 5: Update Route Handlers

Modify each route to use pagination helper:

**`src/routes/drives.ts`:**

```typescript
// GET /drives/:driveId/root/children
router.get('/:driveId/root/children', async (req, res) => {
  const { driveId } = req.params;
  const odataParams = req.odataParams;

  // Get total count for pagination
  const totalCount = await db.getChildrenCount(driveId, 'root');

  // Get paginated items
  const items = await db.getChildren(driveId, 'root', {
    limit: odataParams.top,
    offset: odataParams.skip,
    orderBy: odataParams.orderBy
  });

  // Apply select
  const selectedItems = items.map(item =>
    applySelect(formatDriveItem(item), odataParams.select)
  );

  res.json(formatPaginatedResponse(
    selectedItems,
    totalCount,
    req,
    odataParams
  ));
});

// GET /drives/:driveId/items/:itemId/children
router.get('/:driveId/items/:itemId/children', async (req, res) => {
  const { driveId, itemId } = req.params;
  const odataParams = req.odataParams;

  const totalCount = await db.getChildrenCount(driveId, itemId);
  const items = await db.getChildren(driveId, itemId, {
    limit: odataParams.top,
    offset: odataParams.skip
  });

  const selectedItems = items.map(item =>
    applySelect(formatDriveItem(item), odataParams.select)
  );

  res.json(formatPaginatedResponse(
    selectedItems,
    totalCount,
    req,
    odataParams
  ));
});
```

**`src/routes/sites.ts`:**

```typescript
// GET /sites
router.get('/', async (req, res) => {
  const odataParams = req.odataParams;

  const totalCount = await db.getSitesCount();
  const sites = await db.getSites({
    limit: odataParams.top,
    offset: odataParams.skip
  });

  const selectedSites = sites.map(site =>
    applySelect(formatSite(site), odataParams.select)
  );

  res.json(formatPaginatedResponse(
    selectedSites,
    totalCount,
    req,
    odataParams
  ));
});
```

**`src/routes/lists.ts`:**

```typescript
// GET /sites/:siteId/lists/:listId/items
router.get('/:siteId/lists/:listId/items', async (req, res) => {
  const { siteId, listId } = req.params;
  const odataParams = req.odataParams;

  const totalCount = await db.getListItemsCount(listId);
  const items = await db.getListItems(listId, {
    limit: odataParams.top,
    offset: odataParams.skip
  });

  const selectedItems = items.map(item =>
    applySelect(formatListItem(item), odataParams.select)
  );

  res.json(formatPaginatedResponse(
    selectedItems,
    totalCount,
    req,
    odataParams
  ));
});
```

### Step 6: Add Count Methods to Database

Update `src/services/database.ts`:

```typescript
getChildrenCount(driveId: string, parentId: string): number {
  const stmt = this.db.prepare(`
    SELECT COUNT(*) as count FROM items
    WHERE parent_id = ? AND type IN ('file', 'folder')
  `);
  const result = stmt.get(parentId === 'root' ? driveId : parentId);
  return result.count;
}

getSitesCount(): number {
  const stmt = this.db.prepare(`
    SELECT COUNT(*) as count FROM items
    WHERE type IN ('site', 'siteCollection')
  `);
  const result = stmt.get();
  return result.count;
}

getListItemsCount(listId: string): number {
  const stmt = this.db.prepare(`
    SELECT COUNT(*) as count FROM items
    WHERE parent_id = ? AND type = 'listItem'
  `);
  const result = stmt.get(listId);
  return result.count;
}
```

### Step 7: Handle $count Parameter

When `$count=true` is specified, always include the count:

```typescript
// In route handlers
if (odataParams.count) {
  // Count is already included by formatPaginatedResponse
}
```

## Test Cases

```typescript
describe('@odata.nextLink pagination', () => {
  beforeAll(async () => {
    // Create 25 test files
    for (let i = 0; i < 25; i++) {
      await createFile(driveId, `file-${i}.txt`);
    }
  });

  test('Returns nextLink when more results exist', async () => {
    const response = await request(app)
      .get(`/v1.0/drives/${driveId}/root/children?$top=10`);

    expect(response.status).toBe(200);
    expect(response.body.value).toHaveLength(10);
    expect(response.body['@odata.nextLink']).toBeDefined();
    expect(response.body['@odata.nextLink']).toContain('$skiptoken=');
  });

  test('Following nextLink returns next page', async () => {
    const page1 = await request(app)
      .get(`/v1.0/drives/${driveId}/root/children?$top=10`);

    const nextLink = new URL(page1.body['@odata.nextLink']);
    const page2 = await request(app)
      .get(nextLink.pathname + nextLink.search);

    expect(page2.status).toBe(200);
    expect(page2.body.value).toHaveLength(10);

    // Verify no overlap
    const page1Ids = page1.body.value.map(i => i.id);
    const page2Ids = page2.body.value.map(i => i.id);
    expect(page1Ids).not.toEqual(expect.arrayContaining(page2Ids));
  });

  test('Last page has no nextLink', async () => {
    // Get to last page
    let response = await request(app)
      .get(`/v1.0/drives/${driveId}/root/children?$top=10`);

    while (response.body['@odata.nextLink']) {
      const nextLink = new URL(response.body['@odata.nextLink']);
      response = await request(app)
        .get(nextLink.pathname + nextLink.search);
    }

    expect(response.body['@odata.nextLink']).toBeUndefined();
  });

  test('$count=true includes total count', async () => {
    const response = await request(app)
      .get(`/v1.0/drives/${driveId}/root/children?$count=true&$top=10`);

    expect(response.body['@odata.count']).toBe(25);
    expect(response.body.value).toHaveLength(10);
  });

  test('Empty collection returns no nextLink', async () => {
    const response = await request(app)
      .get(`/v1.0/drives/${emptyDriveId}/root/children`);

    expect(response.body.value).toHaveLength(0);
    expect(response.body['@odata.nextLink']).toBeUndefined();
  });

  test('Preserves query params in nextLink', async () => {
    const response = await request(app)
      .get(`/v1.0/drives/${driveId}/root/children?$top=10&$select=id,name`);

    const nextLink = response.body['@odata.nextLink'];
    expect(nextLink).toContain('select');
  });
});
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/utils/skiptoken.ts` | Create - Skiptoken encoding/decoding |
| `src/middleware/odata.ts` | Modify - Add pagination helpers |
| `src/config/types.ts` | Modify - Add pagination constants |
| `src/services/database.ts` | Modify - Add count methods |
| `src/routes/drives.ts` | Modify - Use pagination helpers |
| `src/routes/sites.ts` | Modify - Use pagination helpers |
| `src/routes/lists.ts` | Modify - Use pagination helpers |
| `tests/middleware/pagination.test.ts` | Create - Pagination tests |

## Edge Cases

1. **Empty results**: No nextLink, count = 0
2. **Exact page boundary**: Last page has no nextLink even if full
3. **$skip beyond total**: Empty results, no nextLink
4. **$top > MAX_PAGE_SIZE**: Cap at maximum
5. **Concurrent modifications**: Items may shift between pages

## Success Criteria

1. `@odata.nextLink` appears when more results exist
2. Following nextLink returns subsequent pages
3. No duplicate items across pages
4. Final page has no nextLink
5. `$count=true` returns total item count
6. Query parameters are preserved in nextLink
7. Skiptoken is opaque but functional
