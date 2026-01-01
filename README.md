# Mock SharePoint Server

A local Node.js server that mimics Microsoft Graph SharePoint endpoints for testing and development.

## Installation

```bash
npm install -g mock-sp-server
```

Or use directly with npx:

```bash
npx mock-sp-server
```

## Quick Start

```bash
# Initialize a sample data directory
npx mock-sp-server init ./my-sharepoint

# Start the server
npx mock-sp-server --root ./my-sharepoint

# Test an endpoint
curl http://localhost:5001/v1.0/sites
```

## Configuration

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port` | Port to listen on | 5001 |
| `-r, --root` | Root data directory | ./data |
| `-a, --auth` | Auth mode (none, static, oauth) | none |
| `-d, --database` | SQLite database path | ./mock-sp.db |
| `-l, --logging` | Log level | info |
| `-c, --config` | Config file path | ./mock-sp.config.json |

### Config File

```json
{
  "port": 5001,
  "root": "./data",
  "auth": {
    "mode": "none",
    "tokens": ["dev-token"]
  },
  "database": "./mock-sp.db",
  "logging": "info"
}
```

### Programmatic API

```typescript
import { createMockServer } from 'mock-sp-server';

const server = createMockServer({
  port: 5001,
  root: './test-fixtures',
  auth: { mode: 'none' },
  database: ':memory:',
  logging: 'error'
});

await server.start();
// ... run tests ...
await server.stop();
```

## Directory Structure

```
data/
├── contoso/                    # Site collection
│   ├── _site.json              # Site collection metadata
│   └── main/                   # Site
│       ├── _site.json          # Site metadata
│       └── Documents/          # Document library
│           ├── _library.json   # Library metadata
│           └── file.docx       # Actual file
```

## Supported Endpoints

### Sites
- `GET /v1.0/sites` - List site collections
- `GET /v1.0/sites/{id}` - Get site by ID
- `GET /v1.0/sites/{id}/sites` - Get subsites

### Lists
- `GET /v1.0/sites/{id}/lists` - List all lists
- `GET /v1.0/sites/{id}/lists/{listId}` - Get list
- `GET /v1.0/sites/{id}/lists/{listId}/items` - Get items
- `POST /v1.0/sites/{id}/lists/{listId}/items` - Create item
- `PATCH /v1.0/sites/{id}/lists/{listId}/items/{itemId}` - Update
- `DELETE /v1.0/sites/{id}/lists/{listId}/items/{itemId}` - Delete

### Drives
- `GET /v1.0/sites/{id}/drives` - List drives
- `GET /v1.0/drives/{id}/root/children` - List root contents
- `GET /v1.0/drives/{id}/items/{itemId}` - Get item
- `GET /v1.0/drives/{id}/items/{itemId}/content` - Download
- `PUT /v1.0/drives/{id}/items/{itemId}/content` - Upload
- `DELETE /v1.0/drives/{id}/items/{itemId}` - Delete

## License

MIT
