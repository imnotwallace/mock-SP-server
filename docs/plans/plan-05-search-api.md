# Plan 05: Search API

## Overview

Implement Microsoft Search API endpoints to search across files, folders, and list items. This includes both the POST `/search/query` endpoint and the GET `driveItem/search` endpoint.

## References

- [Microsoft Search API overview](https://learn.microsoft.com/en-us/graph/search-concept-overview)
- [Search OneDrive and SharePoint](https://learn.microsoft.com/en-us/graph/search-concept-files)
- [driveItem: search](https://learn.microsoft.com/en-us/graph/api/driveitem-search?view=graph-rest-1.0)
- [$search query parameter](https://learn.microsoft.com/en-us/graph/search-query-parameter)

## Current State

- `$search` parameter is parsed but not implemented
- No `/search/query` endpoint exists
- No full-text search capability

## API Specifications

### Microsoft Search API (POST)

**Endpoint:** `POST /search/query`

**Request Body:**
```json
{
  "requests": [
    {
      "entityTypes": ["driveItem"],
      "query": {
        "queryString": "contoso filetype:docx"
      },
      "from": 0,
      "size": 25,
      "fields": ["id", "name", "createdBy", "lastModifiedDateTime"]
    }
  ]
}
```

**Response:**
```json
{
  "value": [
    {
      "searchTerms": ["contoso"],
      "hitsContainers": [
        {
          "hits": [
            {
              "hitId": "item-id",
              "rank": 1,
              "summary": "...contoso project document...",
              "resource": {
                "@odata.type": "#microsoft.graph.driveItem",
                "id": "...",
                "name": "Contoso Project.docx",
                ...
              }
            }
          ],
          "total": 42,
          "moreResultsAvailable": true
        }
      ]
    }
  ]
}
```

### DriveItem Search API (GET)

**Endpoint:** `GET /drives/{driveId}/root/search(q='{search-text}')`

**Response:**
```json
{
  "@odata.context": "...",
  "value": [
    {
      "id": "...",
      "name": "matching-file.docx",
      ...
    }
  ]
}
```

## Implementation Steps

### Step 1: Create Search Service

Create `src/services/search.ts`:

```typescript
interface SearchQuery {
  queryString: string;
  entityTypes: ('driveItem' | 'listItem' | 'list' | 'site')[];
  from?: number;
  size?: number;
  fields?: string[];
}

interface SearchHit {
  hitId: string;
  rank: number;
  summary: string;
  resource: object;
}

interface SearchResult {
  searchTerms: string[];
  hitsContainers: {
    hits: SearchHit[];
    total: number;
    moreResultsAvailable: boolean;
  }[];
}

export class SearchService {
  constructor(private db: DatabaseService) {}

  async search(query: SearchQuery): Promise<SearchResult> {
    const { queryString, entityTypes, from = 0, size = 25 } = query;

    // Parse the query string
    const { terms, filters } = this.parseQueryString(queryString);

    // Search each entity type
    const hits: SearchHit[] = [];

    if (entityTypes.includes('driveItem')) {
      const driveItems = await this.searchDriveItems(terms, filters, from, size);
      hits.push(...driveItems);
    }

    if (entityTypes.includes('listItem')) {
      const listItems = await this.searchListItems(terms, filters, from, size);
      hits.push(...listItems);
    }

    if (entityTypes.includes('site')) {
      const sites = await this.searchSites(terms, filters, from, size);
      hits.push(...sites);
    }

    // Sort by relevance (rank)
    hits.sort((a, b) => b.rank - a.rank);

    // Apply pagination
    const paginatedHits = hits.slice(from, from + size);

    return {
      searchTerms: terms,
      hitsContainers: [{
        hits: paginatedHits,
        total: hits.length,
        moreResultsAvailable: from + size < hits.length
      }]
    };
  }

  private parseQueryString(queryString: string): {
    terms: string[];
    filters: Record<string, string>;
  } {
    const filters: Record<string, string> = {};
    const terms: string[] = [];

    // Parse KQL-style filters: filetype:docx, path:"...", isDocument:true
    const tokens = queryString.match(/(\w+:[^\s]+|"[^"]+"|[^\s]+)/g) || [];

    for (const token of tokens) {
      if (token.includes(':') && !token.startsWith('"')) {
        const [key, value] = token.split(':');
        filters[key.toLowerCase()] = value.replace(/"/g, '');
      } else {
        terms.push(token.replace(/"/g, ''));
      }
    }

    return { terms, filters };
  }

  private async searchDriveItems(
    terms: string[],
    filters: Record<string, string>,
    from: number,
    size: number
  ): Promise<SearchHit[]> {
    // Build SQL query with LIKE patterns
    let sql = `
      SELECT i.*, fv.field_value as content_preview
      FROM items i
      LEFT JOIN field_values fv ON i.id = fv.item_id AND fv.field_name = 'contentPreview'
      WHERE i.type IN ('file', 'folder')
    `;
    const params: any[] = [];

    // Apply text search on name
    if (terms.length > 0) {
      const termConditions = terms.map(() => 'i.name LIKE ?').join(' AND ');
      sql += ` AND (${termConditions})`;
      params.push(...terms.map(t => `%${t}%`));
    }

    // Apply filters
    if (filters.filetype) {
      sql += ` AND i.name LIKE ?`;
      params.push(`%.${filters.filetype}`);
    }

    if (filters.path) {
      sql += ` AND i.path LIKE ?`;
      params.push(`${filters.path}%`);
    }

    if (filters.isdocument === 'true') {
      sql += ` AND i.type = 'file'`;
    }

    sql += ` LIMIT ? OFFSET ?`;
    params.push(size * 2, from); // Fetch extra for ranking

    const items = this.db.query(sql, params);

    return items.map((item, index) => ({
      hitId: item.id,
      rank: this.calculateRank(item, terms),
      summary: this.generateSummary(item, terms),
      resource: {
        '@odata.type': '#microsoft.graph.driveItem',
        ...formatDriveItem(item)
      }
    }));
  }

  private calculateRank(item: any, terms: string[]): number {
    let rank = 0;
    const nameLower = item.name.toLowerCase();

    for (const term of terms) {
      const termLower = term.toLowerCase();
      if (nameLower === termLower) rank += 100;        // Exact match
      else if (nameLower.startsWith(termLower)) rank += 50;  // Prefix match
      else if (nameLower.includes(termLower)) rank += 25;    // Contains
    }

    return rank;
  }

  private generateSummary(item: any, terms: string[]): string {
    // Generate a snippet with matching terms highlighted
    const preview = item.content_preview || item.name;
    // In real impl, would highlight matching terms
    return preview.substring(0, 200);
  }
}
```

### Step 2: Add Search Route

Create `src/routes/search.ts`:

```typescript
import { Router } from 'express';
import { SearchService } from '../services/search';

const router = Router();

// POST /search/query
router.post('/query', async (req, res) => {
  const { requests } = req.body;

  if (!requests || !Array.isArray(requests)) {
    throw GraphError.badRequest('requests array is required');
  }

  const searchService = new SearchService(db);
  const results = [];

  for (const request of requests) {
    const { entityTypes, query, from, size, fields } = request;

    if (!entityTypes || !query?.queryString) {
      throw GraphError.badRequest('entityTypes and query.queryString are required');
    }

    const result = await searchService.search({
      queryString: query.queryString,
      entityTypes,
      from: from || 0,
      size: Math.min(size || 25, 200),
      fields
    });

    results.push(result);
  }

  res.json({ value: results });
});

export { router as searchRouter };
```

### Step 3: Add DriveItem Search Endpoint

Add to `src/routes/drives.ts`:

```typescript
// GET /drives/:driveId/root/search(q='{search}')
// Express requires special handling for OData function syntax
router.get('/:driveId/root/search\\(q=:query\\)', async (req, res) => {
  const { driveId, query } = req.params;
  const searchText = query.replace(/^'|'$/g, ''); // Remove quotes

  const searchService = new SearchService(db);
  const result = await searchService.searchInDrive(driveId, searchText);

  res.json(formatODataResponse(result.items, req));
});

// Also support query parameter style
router.get('/:driveId/search', async (req, res) => {
  const { driveId } = req.params;
  const searchText = req.query.q as string;

  if (!searchText) {
    throw GraphError.badRequest('Search query (q) is required');
  }

  const searchService = new SearchService(db);
  const result = await searchService.searchInDrive(driveId, searchText);

  res.json(formatODataResponse(result.items, req));
});
```

### Step 4: Add Site Search Endpoint

Add to `src/routes/sites.ts`:

```typescript
// GET /sites?search={query}
// This uses $search parameter, already parsed in OData middleware
router.get('/', async (req, res) => {
  const odataParams = req.odataParams;

  let sites: Site[];

  if (odataParams.search) {
    const searchService = new SearchService(db);
    sites = await searchService.searchSites(odataParams.search);
  } else {
    sites = await db.getSites();
  }

  // Apply pagination and format
  res.json(formatPaginatedResponse(sites, ...));
});
```

### Step 5: Implement Search Within Drive

Add to `src/services/search.ts`:

```typescript
async searchInDrive(driveId: string, queryString: string): Promise<{
  items: DriveItem[];
  total: number;
}> {
  const { terms, filters } = this.parseQueryString(queryString);

  let sql = `
    SELECT i.*
    FROM items i
    WHERE i.path LIKE ?
    AND i.type IN ('file', 'folder')
  `;
  const params: any[] = [`%/${driveId}/%`];

  // Apply text search
  if (terms.length > 0) {
    const termConditions = terms.map(() => 'i.name LIKE ?').join(' AND ');
    sql += ` AND (${termConditions})`;
    params.push(...terms.map(t => `%${t}%`));
  }

  // Apply filters
  if (filters.filetype) {
    sql += ` AND i.name LIKE ?`;
    params.push(`%.${filters.filetype}`);
  }

  sql += ` ORDER BY i.name LIMIT 200`;

  const items = this.db.query(sql, params);

  return {
    items: items.map(formatDriveItem),
    total: items.length
  };
}
```

### Step 6: Register Search Route

Update `src/server.ts`:

```typescript
import { searchRouter } from './routes/search';

// Register routes
app.use('/v1.0/search', searchRouter);
```

## Supported Query Syntax

### KQL-Style Filters

| Filter | Example | Description |
|--------|---------|-------------|
| `filetype:` | `filetype:docx` | Filter by file extension |
| `path:` | `path:"https://contoso.sharepoint.com/sites/Team"` | Scope to path |
| `isDocument:` | `isDocument:true` | Only documents |
| `author:` | `author:"John Doe"` | Filter by author |
| `lastModifiedTime:` | `lastModifiedTime>2024-01-01` | Date range filter |

### Boolean Operators

| Operator | Example |
|----------|---------|
| `AND` | `contoso AND report` |
| `OR` | `docx OR xlsx` |
| `NOT` | `NOT draft` |
| Phrase | `"quarterly report"` |

## Test Cases

```typescript
describe('Search API', () => {
  describe('POST /search/query', () => {
    test('searches driveItems by name', async () => {
      const response = await request(app)
        .post('/v1.0/search/query')
        .send({
          requests: [{
            entityTypes: ['driveItem'],
            query: { queryString: 'test' }
          }]
        });

      expect(response.status).toBe(200);
      expect(response.body.value[0].hitsContainers[0].hits).toBeDefined();
    });

    test('applies filetype filter', async () => {
      const response = await request(app)
        .post('/v1.0/search/query')
        .send({
          requests: [{
            entityTypes: ['driveItem'],
            query: { queryString: 'filetype:pdf' }
          }]
        });

      const hits = response.body.value[0].hitsContainers[0].hits;
      expect(hits.every(h => h.resource.name.endsWith('.pdf'))).toBe(true);
    });

    test('supports pagination', async () => {
      const response = await request(app)
        .post('/v1.0/search/query')
        .send({
          requests: [{
            entityTypes: ['driveItem'],
            query: { queryString: '*' },
            from: 0,
            size: 10
          }]
        });

      expect(response.body.value[0].hitsContainers[0].hits).toHaveLength(10);
      expect(response.body.value[0].hitsContainers[0].moreResultsAvailable).toBe(true);
    });
  });

  describe('GET /drives/{id}/root/search', () => {
    test('searches within drive', async () => {
      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/search?q=document`);

      expect(response.status).toBe(200);
      expect(response.body.value).toBeInstanceOf(Array);
    });

    test('returns empty for no matches', async () => {
      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/search?q=xyznonexistent123`);

      expect(response.body.value).toHaveLength(0);
    });
  });
});
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/services/search.ts` | Create - Search service |
| `src/routes/search.ts` | Create - Search endpoints |
| `src/routes/drives.ts` | Modify - Add driveItem search |
| `src/routes/sites.ts` | Modify - Add $search support |
| `src/server.ts` | Modify - Register search routes |
| `tests/routes/search.test.ts` | Create - Search tests |

## Limitations

- No full-text content search (would require file parsing)
- Simplified ranking algorithm
- No aggregations/refiners support
- No spelling correction
- Limited KQL operator support
- Page size capped at 200 (real API caps at 1000)

## Success Criteria

1. POST `/search/query` returns search results
2. Multiple entity types can be searched
3. KQL filters work (filetype, path, etc.)
4. Pagination works with from/size
5. DriveItem search scopes to specific drive
6. `$search` parameter works on collections
7. Results include relevance ranking
