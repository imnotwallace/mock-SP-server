# Plan 01: OData $filter Implementation

## Overview

Implement OData `$filter` query parameter support to filter collections based on property conditions. This is essential for realistic SharePoint client testing as `$filter` is one of the most commonly used query parameters.

## References

- [Microsoft Learn: $filter query parameter](https://learn.microsoft.com/en-us/graph/filter-query-parameter)
- [SharePoint OData operations](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/use-odata-query-operations-in-sharepoint-rest-requests)

## Current State

- `$filter` parameter is parsed by `src/middleware/odata.ts` via `parseODataQuery()`
- The parsed filter string is available in `req.odataParams.filter`
- No actual filtering is applied to result sets

## Implementation Steps

### Step 1: Create Filter Parser (`src/utils/odata-filter.ts`)

Parse OData filter expressions into an AST (Abstract Syntax Tree):

```typescript
interface FilterExpression {
  type: 'comparison' | 'logical' | 'function';
}

interface ComparisonExpression extends FilterExpression {
  type: 'comparison';
  left: string;           // Property path (e.g., "name", "fields/Status")
  operator: 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le';
  right: string | number | boolean | Date | null;
}

interface LogicalExpression extends FilterExpression {
  type: 'logical';
  operator: 'and' | 'or' | 'not';
  operands: FilterExpression[];
}

interface FunctionExpression extends FilterExpression {
  type: 'function';
  name: 'startswith' | 'endswith' | 'contains' | 'substringof';
  args: (string | FilterExpression)[];
}

function parseFilter(filterString: string): FilterExpression;
```

### Step 2: Implement Supported Operators

**Comparison Operators:**
| Operator | Description | Example |
|----------|-------------|---------|
| `eq` | Equals | `name eq 'Document.docx'` |
| `ne` | Not equals | `status ne 'Draft'` |
| `gt` | Greater than | `size gt 1000` |
| `ge` | Greater or equal | `createdDateTime ge 2024-01-01` |
| `lt` | Less than | `size lt 5000000` |
| `le` | Less or equal | `lastModifiedDateTime le 2024-12-31` |

**Logical Operators:**
| Operator | Example |
|----------|---------|
| `and` | `size gt 100 and size lt 1000` |
| `or` | `name eq 'a.txt' or name eq 'b.txt'` |
| `not` | `not startswith(name, 'temp')` |

**String Functions:**
| Function | Example |
|----------|---------|
| `startswith` | `startswith(name, 'Report')` |
| `endswith` | `endswith(name, '.pdf')` |
| `contains` | `contains(name, 'draft')` |

### Step 3: Implement Filter Evaluator (`src/utils/odata-filter.ts`)

```typescript
function evaluateFilter(
  item: Record<string, unknown>,
  expression: FilterExpression
): boolean;

function applyFilter<T>(
  items: T[],
  filterString: string
): T[];
```

Handle nested property access for `fields/*` patterns:
- `fields/Status eq 'Active'` should access `item.fields.Status`
- Support dot notation: `createdBy/user/displayName`

### Step 4: Integrate with Routes

Update route handlers to apply filtering:

**`src/routes/drives.ts`:**
```typescript
// In GET /drives/{id}/items/{id}/children
let items = await getChildren(driveId, itemId);
if (req.odataParams.filter) {
  items = applyFilter(items, req.odataParams.filter);
}
// Then apply pagination
items = applyPagination(items, req.odataParams);
```

**`src/routes/lists.ts`:**
```typescript
// In GET /sites/{id}/lists/{id}/items
let items = await getListItems(siteId, listId);
if (req.odataParams.filter) {
  items = applyFilter(items, req.odataParams.filter);
}
```

**`src/routes/sites.ts`:**
```typescript
// In GET /sites
let sites = await getAllSites();
if (req.odataParams.filter) {
  sites = applyFilter(sites, req.odataParams.filter);
}
```

### Step 5: Handle SharePoint-Specific Patterns

SharePoint uses `fields/` prefix for custom columns:
```
$filter=fields/Modified gt '2024-01-14'
$filter=fields/Department eq 'Sales'
```

Standard properties cannot be filtered directly in real SharePoint, but we can be more permissive in the mock.

### Step 6: Type Coercion

Handle different value types in comparisons:
- Strings: Single-quoted `'value'`
- Numbers: Unquoted `123` or `123.45`
- Booleans: `true` or `false`
- Dates: ISO 8601 format `2024-01-15T00:00:00Z`
- Null: `null`
- GUIDs: Unquoted (unlike most strings)

### Step 7: Error Handling

Return proper Graph API errors for invalid filters:

```typescript
if (!isValidFilter(filterString)) {
  throw GraphError.badRequest('Invalid filter expression');
}
```

## Test Cases

Create `tests/middleware/odata-filter.test.ts`:

```typescript
describe('OData $filter', () => {
  describe('parseFilter', () => {
    test('parses simple equality', () => {
      const result = parseFilter("name eq 'test.txt'");
      expect(result).toEqual({
        type: 'comparison',
        left: 'name',
        operator: 'eq',
        right: 'test.txt'
      });
    });

    test('parses logical AND', () => {
      const result = parseFilter("size gt 100 and size lt 1000");
      // ...
    });

    test('parses nested field access', () => {
      const result = parseFilter("fields/Status eq 'Active'");
      // ...
    });

    test('parses string functions', () => {
      const result = parseFilter("startswith(name, 'Report')");
      // ...
    });
  });

  describe('applyFilter', () => {
    const items = [
      { name: 'a.txt', size: 100 },
      { name: 'b.pdf', size: 500 },
      { name: 'c.txt', size: 1000 }
    ];

    test('filters by equality', () => {
      const result = applyFilter(items, "name eq 'a.txt'");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('a.txt');
    });

    test('filters with AND', () => {
      const result = applyFilter(items, "size gt 50 and size lt 600");
      expect(result).toHaveLength(2);
    });
  });
});
```

Integration tests in `tests/routes/drives.test.ts`:

```typescript
describe('GET /drives/{id}/root/children with $filter', () => {
  test('filters by name equality', async () => {
    const response = await request(app)
      .get(`/v1.0/drives/${driveId}/root/children?$filter=name eq 'test.txt'`);
    expect(response.status).toBe(200);
    expect(response.body.value.every(i => i.name === 'test.txt')).toBe(true);
  });

  test('filters by size range', async () => {
    const response = await request(app)
      .get(`/v1.0/drives/${driveId}/root/children?$filter=size gt 1000`);
    expect(response.status).toBe(200);
    expect(response.body.value.every(i => i.size > 1000)).toBe(true);
  });
});
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/utils/odata-filter.ts` | Create - Parser and evaluator |
| `src/middleware/odata.ts` | Modify - Export applyFilter helper |
| `src/routes/drives.ts` | Modify - Apply filtering |
| `src/routes/lists.ts` | Modify - Apply filtering |
| `src/routes/sites.ts` | Modify - Apply filtering |
| `tests/utils/odata-filter.test.ts` | Create - Unit tests |
| `tests/routes/*.test.ts` | Modify - Integration tests |

## Limitations (Acceptable for Mock)

- No support for `any()` / `all()` lambda operators on collections
- No support for arithmetic expressions (`size div 1024`)
- No geographic/spatial functions
- Case sensitivity matches JavaScript behavior (can add `tolower()` if needed)

## Success Criteria

1. Basic comparison operators work on all collection endpoints
2. Logical AND/OR/NOT combine expressions correctly
3. String functions filter text properties
4. Nested field access works for `fields/*` patterns
5. Invalid expressions return 400 Bad Request
6. Filter applies before pagination ($top/$skip)
