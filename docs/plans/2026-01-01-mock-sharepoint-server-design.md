# Mock SharePoint Server Design

## Overview

A local Node.js/TypeScript server that mimics Microsoft Graph SharePoint endpoints for testing and development without requiring a real SharePoint tenant.

## Use Cases

- **Development sandbox** (primary) - Build/debug apps without live SharePoint
- **Integration testing** - Test HTTP calls against realistic endpoints
- **Unit testing** - Predictable responses for automated tests
- **Demo/training** - Showcase integrations without live data

## Technology Stack

- **Runtime**: Node.js
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: SQLite (better-sqlite3)
- **No Docker** - Direct Node.js execution only

## Configuration

### Default Port

**5001** (configurable via CLI or config file)

### Config File (`mock-sp.config.json`)

```json
{
  "port": 5001,
  "root": "./data",
  "auth": {
    "mode": "none",
    "tokens": ["dev-token-123"]
  },
  "database": "./mock-sp.db",
  "logging": "info"
}
```

### CLI Interface

```bash
# Install globally
npm install -g mock-sp-server

# Or run directly via npx
npx mock-sp-server

# With options (override config file)
npx mock-sp-server --port 8080 --root ./my-data --auth none

# Initialize a new data directory with example structure
npx mock-sp-server init ./my-sharepoint
```

### Programmatic API

```typescript
import { createMockServer } from 'mock-sp-server';

const server = createMockServer({
  port: 5001,
  root: './test-fixtures',
  auth: { mode: 'none' }
});

await server.start();
// ... run tests ...
await server.stop();
```

## Filesystem Mapping

### Directory Structure

```
data/                              # Root (tenant level)
├── contoso/                       # Site collection: /sites/contoso
│   ├── _site.json                 # Site collection metadata (optional)
│   ├── main/                      # Site: /sites/contoso/main
│   │   ├── _site.json             # Site metadata
│   │   ├── Documents/             # Library: .../lists/Documents
│   │   │   ├── _library.json      # Library settings, columns
│   │   │   ├── Q1 Report.docx     # DriveItem
│   │   │   └── Archives/          # Folder
│   │   │       └── old.pdf
│   │   └── Tasks/                 # List: .../lists/Tasks
│   │       ├── _list.json         # List schema, columns
│   │       └── _items.json        # List items (non-file based)
```

### Hierarchy

| Level | Represents |
|-------|------------|
| Root | All site collections (tenant) |
| Level 1 | Site collection |
| Level 2 | Site |
| Level 3 | Document library or list |
| Level 4+ | Folders and files within library |

### Metadata Files

Underscore-prefixed files contain metadata, not content:

- `_site.json` - Site display name, description, created date
- `_library.json` - Library columns, content types, views
- `_list.json` - List schema for non-document lists
- `_items.json` - List item data (for lists without physical files)

### ID Generation

Deterministic GUIDs generated from paths for consistency:
- `sites/contoso` -> `sha256("sites/contoso").slice(0,36)` formatted as GUID
- Consistent across restarts, predictable for tests

## Project Structure

```
mock-sp-server/
├── src/
│   ├── server.ts              # Express app, middleware setup
│   ├── config/                # Config loading, validation
│   ├── routes/                # Route handlers by domain
│   │   ├── sites.ts
│   │   ├── lists.ts
│   │   ├── drives.ts
│   │   └── auth.ts
│   ├── services/              # Business logic layer
│   │   ├── filesystem.ts      # Maps local files <-> SharePoint items
│   │   ├── metadata.ts        # SQLite/JSON metadata store
│   │   └── odata.ts           # Query param parsing/filtering
│   ├── models/                # TypeScript types matching Graph schemas
│   └── index.ts               # Programmatic API export
├── bin/
│   └── cli.ts                 # CLI entry point
├── mock-sp.config.json        # Default config
└── data/                      # Default root for mock SharePoint content
```

## API Endpoints

### Phase 1 (Initial Release)

**Sites**
```
GET  /v1.0/sites                                    # Search/list sites
GET  /v1.0/sites/{siteId}                           # Get site by ID
GET  /v1.0/sites/{host}:/{path}                     # Get site by path
GET  /v1.0/sites/{siteId}/sites                     # Get subsites
```

**Lists & List Items**
```
GET  /v1.0/sites/{siteId}/lists                     # All lists in site
GET  /v1.0/sites/{siteId}/lists/{listId}            # Get list
GET  /v1.0/sites/{siteId}/lists/{listId}/items      # List items
POST /v1.0/sites/{siteId}/lists/{listId}/items      # Create item
PATCH /v1.0/sites/{siteId}/lists/{listId}/items/{itemId}
DELETE /v1.0/sites/{siteId}/lists/{listId}/items/{itemId}
```

**Drives & Files**
```
GET  /v1.0/sites/{siteId}/drives                    # All drives (libraries)
GET  /v1.0/sites/{siteId}/drive                     # Default drive
GET  /v1.0/drives/{driveId}/root/children           # Root folder contents
GET  /v1.0/drives/{driveId}/items/{itemId}          # Get item
GET  /v1.0/drives/{driveId}/items/{itemId}/content  # Download file
PUT  /v1.0/drives/{driveId}/items/{itemId}/content  # Upload/replace file
DELETE /v1.0/drives/{driveId}/items/{itemId}        # Delete item
```

### Phase 2+ (Future)

- Permissions endpoints
- Search API
- Webhooks
- Content types and columns management

## OData Support

### Phase 1

```
$select=id,name,createdDateTime     # Return only specified fields
$expand=fields                       # Expand related entities
$top=25                              # Limit results
$skip=50                             # Pagination offset
```

### Phase 2 (Architecture-Ready)

```
$filter=createdDateTime gt 2024-01-01
$orderby=name desc
$count=true
$search="quarterly report"
```

### Response Format

```json
{
  "@odata.context": "https://localhost:5001/v1.0/$metadata#sites",
  "value": [
    { "id": "...", "name": "contoso", "webUrl": "..." }
  ],
  "@odata.nextLink": "https://localhost:5001/v1.0/sites?$skip=25"
}
```

### Error Format

```json
{
  "error": {
    "code": "itemNotFound",
    "message": "The resource could not be found."
  }
}
```

## Authentication

### Mode 1: None (Default)

```json
{ "auth": { "mode": "none" } }
```

All requests accepted, no Authorization header required.

### Mode 2: Static Token

```json
{ "auth": { "mode": "static", "tokens": ["dev-token-123", "test-token"] } }
```

Requires `Authorization: Bearer <token>`, validates against configured list.

### Mode 3: Mock OAuth

```json
{ "auth": { "mode": "oauth" } }
```

Exposes fake OAuth endpoints:

```
POST /oauth/token          # Returns mock access token
GET  /oauth/authorize      # Mock authorization redirect
```

## Data Persistence

### Hybrid Model

| Data Type | Storage | Reason |
|-----------|---------|--------|
| Files/folders | Filesystem | Real file operations, easy to inspect |
| File metadata | SQLite | Custom columns, SharePoint properties |
| List items | SQLite | No physical files, pure data |
| Site/list config | JSON files | Human-editable, version controllable |

### SQLite Schema

```sql
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,            -- 'file', 'folder', 'listItem'
  parent_id TEXT,
  name TEXT NOT NULL,
  created_at TEXT,
  modified_at TEXT,
  etag TEXT,
  size INTEGER
);

CREATE TABLE field_values (
  item_id TEXT,
  field_name TEXT,
  field_value TEXT,
  PRIMARY KEY (item_id, field_name)
);

CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  principal TEXT,
  role TEXT                      -- 'read', 'write', 'owner'
);
```

### Sync Behavior

On startup:
1. Scan filesystem under root
2. Add new files/folders to database
3. Update metadata for changed files (mtime check)
4. Mark missing files as deleted

## Developer Experience

### Logging

```bash
npx mock-sp-server --logging debug
```

```
[2024-01-15 10:23:45] INFO  Server started on http://localhost:5001
[2024-01-15 10:23:47] DEBUG GET /v1.0/sites/contoso -> 200 (12ms)
```

### Init Command

```bash
npx mock-sp-server init ./my-sharepoint
```

Creates sample structure with example sites, libraries, and files.

### Startup Output

```
Mock SharePoint Server v1.0.0

Root:     ./data
Database: ./mock-sp.db
Auth:     none

Discovered:
  2 site collections
  4 sites
  7 document libraries

Endpoints:
  http://localhost:5001/v1.0/sites
  http://localhost:5001/v1.0/sites/contoso

Ready for requests.
```

## Running the Server

### Prerequisites

- Node.js 18+ installed

### Installation

```bash
# Global install
npm install -g mock-sp-server

# Or use npx (no install required)
npx mock-sp-server
```

### Quick Start

```bash
# 1. Initialize a data directory
npx mock-sp-server init ./my-sharepoint

# 2. Start the server
npx mock-sp-server --root ./my-sharepoint

# 3. Test an endpoint
curl http://localhost:5001/v1.0/sites
```

### Configuration Priority

1. CLI flags (highest priority)
2. Config file (`mock-sp.config.json`)
3. Built-in defaults (lowest priority)
