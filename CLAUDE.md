# Mock SharePoint Server - Project Context

## Overview
A Node.js/TypeScript Express server that mocks Microsoft Graph SharePoint endpoints for local testing and development. Uses SQLite for data storage and filesystem directories to represent SharePoint hierarchy.

## Architecture

### Directory Hierarchy Mapping
- **Level 0** (root directories) = Site Collections
- **Level 1** (subdirectories) = Sites
- **Level 2** (subdirectories) = Document Libraries
- **Level 3+** (files/folders) = Drive Items

### Key Components
- `src/bin/cli.ts` - CLI entry point with `init` and `server` commands
- `src/server.ts` - Express app creation and lifecycle
- `src/routes/` - API endpoint handlers (sites, lists, drives, auth)
- `src/middleware/` - Auth, error handling, OData parsing
- `src/services/database.ts` - SQLite database operations
- `src/services/filesystem.ts` - File scanning and operations

### Metadata Files
- `_site.json` - Site/site collection metadata (displayName, description, webUrl)
- `_library.json` - Library schema (displayName, columns array)
- `_files.json` - Per-file metadata (createdBy, lastModifiedBy, custom fields)
- `_items.json` - List items for non-library lists

## Implemented Graph API Endpoints

### Sites (`/v1.0/sites`)
- `GET /v1.0/sites` - List all sites
- `GET /v1.0/sites/{id}` - Get site by ID
- `GET /v1.0/sites/{id}/sites` - Get subsites

### Lists (`/v1.0/sites/{siteId}/lists`)
- `GET .../lists` - List all lists/libraries
- `GET .../lists/{listId}` - Get single list
- `GET/POST/PATCH/DELETE .../lists/{listId}/items` - CRUD operations

### Drives (`/v1.0/drives`)
- `GET /v1.0/sites/{siteId}/drives` - List drives
- `GET /v1.0/drives/{driveId}/root/children` - List root contents
- `GET /v1.0/drives/{driveId}/items/{itemId}` - Get item
- `GET /v1.0/drives/{driveId}/items/{itemId}/children` - List folder contents
- `GET /v1.0/drives/{driveId}/items/{itemId}/content` - Download file
- `PUT /v1.0/drives/{driveId}/items/{itemId}/content` - Upload file
- `DELETE /v1.0/drives/{driveId}/items/{itemId}` - Delete item

### Auth (`/oauth`)
- `POST /oauth/token` - Generate mock OAuth token
- `GET /oauth/authorize` - Mock authorization endpoint

## OData Support
Supported query parameters: `$select`, `$expand`, `$filter`, `$orderby`, `$top`, `$skip`, `$count`, `$search`

## Authentication Modes
- `none` - No authentication (default)
- `static` - Validates against configured token list
- `oauth` - Validates against tokens from `/oauth/token`

## Database Schema
- **items** table: id, path, type, parent_id, name, created_at, modified_at, etag, size
- **field_values** table: item_id, field_name, field_value (key-value metadata)
- **permissions** table: id, item_id, principal, role (future use)

## Item Types
`file | folder | listItem | site | siteCollection | list | library`

## ID Generation
Deterministic SHA256-based UUIDs from normalized file paths (`src/utils/id.ts`)

## Error Format
Microsoft Graph compatible errors with `code`, `message`, and `innerError` containing `date` and `request-id`

## Development Commands
```bash
npm run build          # Compile TypeScript
npm run test           # Run vitest tests
npm run dev            # Development mode
mock-sp-server init    # Initialize sample data structure
mock-sp-server         # Start the server
```

## Configuration
Config loaded from: defaults < config file < CLI options

```typescript
{
  port: number,           // Default: 5001
  root: string,           // Default: './data'
  auth: { mode, tokens }, // Default: { mode: 'none' }
  database: string,       // Default: './mock-sp.db'
  logging: string         // Default: 'info'
}
```

## Testing
Uses vitest. Tests located in `tests/` directory with integration tests for all routes and unit tests for utilities.

## Key Patterns
- Routes use Express Router with async handlers
- All endpoints wrapped with OData response formatting
- Errors thrown as `GraphError` instances, caught by error middleware
- Database operations are synchronous (better-sqlite3)
- Filesystem scanning populates database on startup
