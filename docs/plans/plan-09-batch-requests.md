# Plan 09: Batch Requests

## Overview

Implement JSON batching to combine multiple API requests into a single HTTP call. This reduces network roundtrips and improves client performance.

## References

- [JSON batching](https://learn.microsoft.com/en-us/graph/json-batching)
- [Batch requests with SDK](https://learn.microsoft.com/en-us/graph/sdks/batch-requests)

## Current State

- No batch endpoint exists
- Each request requires separate HTTP call

## API Specification

### Batch Request

**Endpoint:** `POST /$batch`

**Request Body:**
```json
{
  "requests": [
    {
      "id": "1",
      "method": "GET",
      "url": "/me/drive/root/children"
    },
    {
      "id": "2",
      "method": "GET",
      "url": "/me/drive/items/item-id"
    },
    {
      "id": "3",
      "method": "POST",
      "url": "/me/drive/root/children",
      "body": {
        "name": "New Folder",
        "folder": {}
      },
      "headers": {
        "Content-Type": "application/json"
      }
    }
  ]
}
```

### Batch Response

```json
{
  "responses": [
    {
      "id": "1",
      "status": 200,
      "headers": {
        "Content-Type": "application/json"
      },
      "body": {
        "value": [...]
      }
    },
    {
      "id": "2",
      "status": 200,
      "body": {
        "id": "item-id",
        "name": "file.txt"
      }
    },
    {
      "id": "3",
      "status": 201,
      "body": {
        "id": "new-folder-id",
        "name": "New Folder"
      }
    }
  ]
}
```

### Dependencies Between Requests

```json
{
  "requests": [
    {
      "id": "1",
      "method": "POST",
      "url": "/drives/{drive-id}/root/children",
      "body": { "name": "folder", "folder": {} }
    },
    {
      "id": "2",
      "method": "PUT",
      "url": "$1.id/content",
      "dependsOn": ["1"],
      "body": "file content"
    }
  ]
}
```

## Implementation Steps

### Step 1: Create Batch Service

Create `src/services/batch.ts`:

```typescript
import { Request, Response } from 'express';

interface BatchRequest {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: any;
  dependsOn?: string[];
}

interface BatchResponse {
  id: string;
  status: number;
  headers?: Record<string, string>;
  body?: any;
}

export class BatchService {
  private readonly MAX_REQUESTS = 20;

  constructor(private app: Express.Application) {}

  async processBatch(
    requests: BatchRequest[],
    authHeader?: string
  ): Promise<BatchResponse[]> {
    // Validate request count
    if (requests.length > this.MAX_REQUESTS) {
      throw GraphError.badRequest(
        `Batch requests are limited to ${this.MAX_REQUESTS} requests`
      );
    }

    // Validate unique IDs
    const ids = requests.map(r => r.id);
    if (new Set(ids).size !== ids.length) {
      throw GraphError.badRequest('Request IDs must be unique within a batch');
    }

    // Build dependency graph and execution order
    const executionOrder = this.topologicalSort(requests);

    // Execute requests
    const results: Map<string, BatchResponse> = new Map();
    const resolvedValues: Map<string, any> = new Map();

    for (const requestId of executionOrder) {
      const request = requests.find(r => r.id === requestId)!;

      // Resolve URL references (e.g., $1.id)
      const resolvedUrl = this.resolveReferences(request.url, resolvedValues);
      const resolvedBody = request.body
        ? this.resolveReferences(JSON.stringify(request.body), resolvedValues)
        : undefined;

      // Execute internal request
      const response = await this.executeRequest(
        request.method,
        resolvedUrl,
        resolvedBody ? JSON.parse(resolvedBody) : undefined,
        { ...request.headers, Authorization: authHeader }
      );

      results.set(requestId, response);

      // Store response body for reference resolution
      if (response.body) {
        resolvedValues.set(requestId, response.body);
      }
    }

    // Return responses in original order
    return requests.map(r => results.get(r.id)!);
  }

  private topologicalSort(requests: BatchRequest[]): string[] {
    const graph: Map<string, string[]> = new Map();
    const inDegree: Map<string, number> = new Map();

    // Initialize
    for (const req of requests) {
      graph.set(req.id, []);
      inDegree.set(req.id, 0);
    }

    // Build edges
    for (const req of requests) {
      if (req.dependsOn) {
        for (const dep of req.dependsOn) {
          if (!graph.has(dep)) {
            throw GraphError.badRequest(`Invalid dependency: ${dep}`);
          }
          graph.get(dep)!.push(req.id);
          inDegree.set(req.id, inDegree.get(req.id)! + 1);
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const result: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      for (const neighbor of graph.get(current)!) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (result.length !== requests.length) {
      throw GraphError.badRequest('Circular dependency detected in batch requests');
    }

    return result;
  }

  private resolveReferences(
    str: string,
    resolvedValues: Map<string, any>
  ): string {
    // Replace $N.property patterns
    return str.replace(/\$(\d+)\.(\w+)/g, (match, id, prop) => {
      const value = resolvedValues.get(id);
      if (!value) {
        throw GraphError.badRequest(`Reference $${id} not resolved`);
      }
      const resolved = value[prop];
      if (resolved === undefined) {
        throw GraphError.badRequest(`Property ${prop} not found in $${id}`);
      }
      return resolved;
    });
  }

  private async executeRequest(
    method: string,
    url: string,
    body?: any,
    headers?: Record<string, string>
  ): Promise<BatchResponse> {
    return new Promise((resolve) => {
      // Create mock request/response objects
      const mockReq = this.createMockRequest(method, url, body, headers);
      const mockRes = this.createMockResponse((status, responseHeaders, responseBody) => {
        resolve({
          id: '', // Will be filled by caller
          status,
          headers: responseHeaders,
          body: responseBody
        });
      });

      // Route through Express
      this.app.handle(mockReq, mockRes, (err: any) => {
        if (err) {
          resolve({
            id: '',
            status: err.statusCode || 500,
            body: {
              error: {
                code: err.code || 'internalServerError',
                message: err.message
              }
            }
          });
        }
      });
    });
  }

  private createMockRequest(
    method: string,
    url: string,
    body?: any,
    headers?: Record<string, string>
  ): any {
    const parsedUrl = new URL(url, 'http://localhost');

    return {
      method,
      url: parsedUrl.pathname + parsedUrl.search,
      path: parsedUrl.pathname,
      query: Object.fromEntries(parsedUrl.searchParams),
      headers: headers || {},
      body,
      get: (name: string) => headers?.[name],
      // Add other Express request properties as needed
    };
  }

  private createMockResponse(
    callback: (status: number, headers: Record<string, string>, body: any) => void
  ): any {
    let statusCode = 200;
    const responseHeaders: Record<string, string> = {};
    let responseBody: any;

    return {
      status: (code: number) => {
        statusCode = code;
        return this;
      },
      set: (name: string, value: string) => {
        responseHeaders[name] = value;
        return this;
      },
      setHeader: (name: string, value: string) => {
        responseHeaders[name] = value;
        return this;
      },
      json: (body: any) => {
        responseHeaders['Content-Type'] = 'application/json';
        responseBody = body;
        callback(statusCode, responseHeaders, responseBody);
      },
      send: (body: any) => {
        responseBody = body;
        callback(statusCode, responseHeaders, responseBody);
      },
      end: () => {
        callback(statusCode, responseHeaders, responseBody);
      },
      // Add other Express response methods as needed
    };
  }
}
```

### Step 2: Create Batch Route

Create `src/routes/batch.ts`:

```typescript
import { Router } from 'express';
import { BatchService } from '../services/batch';

export function createBatchRouter(app: Express.Application): Router {
  const router = Router();
  const batchService = new BatchService(app);

  // POST /$batch
  router.post('/', async (req, res) => {
    const { requests } = req.body;

    if (!requests || !Array.isArray(requests)) {
      throw GraphError.badRequest('requests array is required');
    }

    // Validate each request
    for (const request of requests) {
      if (!request.id || !request.method || !request.url) {
        throw GraphError.badRequest('Each request must have id, method, and url');
      }

      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        throw GraphError.badRequest(`Invalid method: ${request.method}`);
      }
    }

    const responses = await batchService.processBatch(
      requests,
      req.get('Authorization')
    );

    // Add request IDs to responses
    responses.forEach((response, index) => {
      response.id = requests[index].id;
    });

    res.json({ responses });
  });

  return router;
}
```

### Step 3: Register Batch Route

Update `src/server.ts`:

```typescript
import { createBatchRouter } from './routes/batch';

export function createApp(config: Config): Express.Application {
  const app = express();

  // ... existing middleware ...

  // Register routes
  app.use('/v1.0/sites', sitesRouter);
  app.use('/v1.0/drives', drivesRouter);
  // ... other routes ...

  // Batch must be registered after other routes
  // so it can route requests internally
  app.use('/v1.0/$batch', createBatchRouter(app));
  app.use('/$batch', createBatchRouter(app)); // Also support without version

  return app;
}
```

### Step 4: Handle Atomicity Option

Support `Prefer: respond-async` and atomicity headers:

```typescript
router.post('/', async (req, res) => {
  const prefer = req.get('Prefer') || '';
  const continueOnError = !prefer.includes('odata.continue-on-error=false');

  // ... process batch ...

  // If any request fails and continueOnError is false,
  // roll back and return error
  if (!continueOnError) {
    const failed = responses.find(r => r.status >= 400);
    if (failed) {
      // Would need transaction support for true atomicity
      // For mock, just return the error
      res.status(failed.status).json({
        error: failed.body?.error || { code: 'batchError', message: 'Batch failed' }
      });
      return;
    }
  }

  res.json({ responses });
});
```

### Step 5: Support Relative URLs

Handle both absolute and relative URLs in batch requests:

```typescript
private normalizeUrl(url: string, baseUrl: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return new URL(url).pathname;
  }
  if (url.startsWith('/')) {
    return url;
  }
  // Relative to /v1.0
  return `/v1.0/${url}`;
}
```

## Test Cases

```typescript
describe('Batch requests', () => {
  describe('POST /$batch', () => {
    test('executes multiple GET requests', async () => {
      const response = await request(app)
        .post('/v1.0/$batch')
        .send({
          requests: [
            { id: '1', method: 'GET', url: `/v1.0/drives/${driveId}/root/children` },
            { id: '2', method: 'GET', url: `/v1.0/sites` }
          ]
        });

      expect(response.status).toBe(200);
      expect(response.body.responses).toHaveLength(2);
      expect(response.body.responses[0].id).toBe('1');
      expect(response.body.responses[0].status).toBe(200);
      expect(response.body.responses[1].id).toBe('2');
    });

    test('executes mixed GET/POST requests', async () => {
      const response = await request(app)
        .post('/v1.0/$batch')
        .send({
          requests: [
            { id: '1', method: 'GET', url: `/v1.0/drives/${driveId}/root` },
            {
              id: '2',
              method: 'POST',
              url: `/v1.0/drives/${driveId}/root/children`,
              headers: { 'Content-Type': 'application/json' },
              body: { name: 'batch-folder', folder: {} }
            }
          ]
        });

      expect(response.body.responses[1].status).toBe(201);
      expect(response.body.responses[1].body.name).toBe('batch-folder');
    });

    test('handles dependencies with dependsOn', async () => {
      const response = await request(app)
        .post('/v1.0/$batch')
        .send({
          requests: [
            {
              id: '1',
              method: 'POST',
              url: `/v1.0/drives/${driveId}/root/children`,
              body: { name: 'parent-folder', folder: {} }
            },
            {
              id: '2',
              method: 'POST',
              url: `/v1.0/drives/${driveId}/items/$1.id/children`,
              body: { name: 'child-folder', folder: {} },
              dependsOn: ['1']
            }
          ]
        });

      expect(response.body.responses[0].status).toBe(201);
      expect(response.body.responses[1].status).toBe(201);
    });

    test('returns individual errors without failing batch', async () => {
      const response = await request(app)
        .post('/v1.0/$batch')
        .send({
          requests: [
            { id: '1', method: 'GET', url: `/v1.0/drives/${driveId}/root/children` },
            { id: '2', method: 'GET', url: `/v1.0/drives/nonexistent/root` }
          ]
        });

      expect(response.status).toBe(200);
      expect(response.body.responses[0].status).toBe(200);
      expect(response.body.responses[1].status).toBe(404);
    });

    test('rejects more than 20 requests', async () => {
      const requests = Array.from({ length: 21 }, (_, i) => ({
        id: String(i),
        method: 'GET',
        url: '/v1.0/sites'
      }));

      const response = await request(app)
        .post('/v1.0/$batch')
        .send({ requests });

      expect(response.status).toBe(400);
    });

    test('rejects duplicate request IDs', async () => {
      const response = await request(app)
        .post('/v1.0/$batch')
        .send({
          requests: [
            { id: '1', method: 'GET', url: '/v1.0/sites' },
            { id: '1', method: 'GET', url: '/v1.0/drives' }
          ]
        });

      expect(response.status).toBe(400);
    });

    test('detects circular dependencies', async () => {
      const response = await request(app)
        .post('/v1.0/$batch')
        .send({
          requests: [
            { id: '1', method: 'GET', url: '/v1.0/sites', dependsOn: ['2'] },
            { id: '2', method: 'GET', url: '/v1.0/drives', dependsOn: ['1'] }
          ]
        });

      expect(response.status).toBe(400);
    });
  });
});
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/services/batch.ts` | Create - Batch processing logic |
| `src/routes/batch.ts` | Create - Batch endpoint |
| `src/server.ts` | Modify - Register batch route |
| `tests/routes/batch.test.ts` | Create - Batch tests |

## Limitations

- No true atomicity (no rollback support)
- Mock request/response objects may not support all Express features
- Sequential execution within dependency chains
- No streaming support for large responses

## Success Criteria

1. Multiple GET requests execute and return results
2. Mixed method requests work
3. Dependencies with `dependsOn` execute in order
4. Reference resolution ($1.id) works
5. Individual request errors don't fail batch
6. 20 request limit enforced
7. Duplicate IDs rejected
8. Circular dependencies detected
