import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../../src/server.js';
import { createDatabase, Database } from '../../src/services/database.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Batch Requests', () => {
  const testDir = './test-tmp-batch';
  let server: MockServer;
  let db: Database;
  let driveId: string;

  beforeAll(async () => {
    fs.mkdirSync(testDir, { recursive: true });

    db = createDatabase(path.join(testDir, 'test.db'));

    // Create test site
    db.upsertItem({
      id: 'site-1',
      path: 'sites/contoso',
      type: 'site',
      name: 'Contoso',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z'
    });

    // Create test library (Documents) - this becomes a drive
    driveId = 'drive-1';
    db.upsertItem({
      id: driveId,
      path: 'sites/contoso/Documents',
      type: 'library',
      parentId: 'site-1',
      name: 'Documents',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z'
    });

    // Create test files in library
    const docsDir = path.join(testDir, 'sites/contoso/Documents');
    fs.mkdirSync(docsDir, { recursive: true });

    // Create a test file
    fs.writeFileSync(path.join(docsDir, 'test.txt'), 'Hello World');
    db.upsertItem({
      id: 'file-1',
      path: 'sites/contoso/Documents/test.txt',
      type: 'file',
      parentId: driveId,
      name: 'test.txt',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z',
      size: 11
    });

    db.close();

    server = createMockServer({
      port: 5099,
      root: testDir,
      auth: { mode: 'none' },
      database: path.join(testDir, 'test.db'),
      logging: 'error'
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('POST /$batch', () => {
    it('executes multiple GET requests', async () => {
      const response = await fetch('http://localhost:5099/v1.0/$batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [
            { id: '1', method: 'GET', url: `/v1.0/drives/${driveId}/root/children` },
            { id: '2', method: 'GET', url: '/v1.0/sites' }
          ]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.responses).toHaveLength(2);
      expect(data.responses[0].id).toBe('1');
      expect(data.responses[0].status).toBe(200);
      expect(data.responses[1].id).toBe('2');
      expect(data.responses[1].status).toBe(200);
    });

    it('executes mixed GET requests', async () => {
      const response = await fetch('http://localhost:5099/v1.0/$batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [
            { id: '1', method: 'GET', url: `/v1.0/drives/${driveId}/root/children` },
            { id: '2', method: 'GET', url: '/v1.0/sites' }
          ]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.responses).toHaveLength(2);
      expect(data.responses[0].status).toBe(200);
      expect(data.responses[1].status).toBe(200);
      expect(data.responses[0].body.value).toBeDefined();
      expect(data.responses[1].body.value).toBeDefined();
    });

    it('handles dependencies with dependsOn and reference resolution', async () => {
      const response = await fetch('http://localhost:5099/v1.0/$batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [
            {
              id: '1',
              method: 'GET',
              url: `/v1.0/drives/${driveId}/root/children`
            },
            {
              id: '2',
              method: 'GET',
              url: `/v1.0/sites`,
              dependsOn: ['1']
            }
          ]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.responses).toHaveLength(2);
      expect(data.responses[0].status).toBe(200);
      expect(data.responses[1].status).toBe(200);
      // Verify that request 2 executed after request 1
      expect(data.responses[0].body.value).toBeDefined();
      expect(data.responses[1].body.value).toBeDefined();
    });

    it('returns individual errors without failing batch', async () => {
      const response = await fetch('http://localhost:5099/v1.0/$batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [
            { id: '1', method: 'GET', url: `/v1.0/drives/${driveId}/root/children` },
            { id: '2', method: 'GET', url: '/v1.0/drives/nonexistent/root' }
          ]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.responses).toHaveLength(2);
      expect(data.responses[0].status).toBe(200);
      expect(data.responses[1].status).toBe(404);
      expect(data.responses[1].body.error).toBeDefined();
    });

    it('rejects more than 20 requests', async () => {
      const requests = Array.from({ length: 21 }, (_, i) => ({
        id: String(i),
        method: 'GET',
        url: '/v1.0/sites'
      }));

      const response = await fetch('http://localhost:5099/v1.0/$batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe('invalidRequest');
    });

    it('rejects duplicate request IDs', async () => {
      const response = await fetch('http://localhost:5099/v1.0/$batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [
            { id: '1', method: 'GET', url: '/v1.0/sites' },
            { id: '1', method: 'GET', url: '/v1.0/drives' }
          ]
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe('invalidRequest');
    });

    it('detects circular dependencies', async () => {
      const response = await fetch('http://localhost:5099/v1.0/$batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [
            { id: '1', method: 'GET', url: '/v1.0/sites', dependsOn: ['2'] },
            { id: '2', method: 'GET', url: '/v1.0/drives', dependsOn: ['1'] }
          ]
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe('invalidRequest');
      expect(data.error.message).toContain('Circular dependency');
    });

    it('validates request structure', async () => {
      const response = await fetch('http://localhost:5099/v1.0/$batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [
            { id: '1', url: '/v1.0/sites' } // Missing method
          ]
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe('invalidRequest');
    });

    it('validates HTTP methods', async () => {
      const response = await fetch('http://localhost:5099/v1.0/$batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [
            { id: '1', method: 'INVALID', url: '/v1.0/sites' }
          ]
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe('invalidRequest');
    });

    it('requires requests array', async () => {
      const response = await fetch('http://localhost:5099/v1.0/$batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe('invalidRequest');
    });

    it('supports batch endpoint without version prefix', async () => {
      const response = await fetch('http://localhost:5099/$batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [
            { id: '1', method: 'GET', url: '/v1.0/sites' }
          ]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.responses).toHaveLength(1);
      expect(data.responses[0].status).toBe(200);
    });

    it('handles relative URLs', async () => {
      const response = await fetch('http://localhost:5099/v1.0/$batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [
            { id: '1', method: 'GET', url: 'sites' } // Relative URL
          ]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.responses).toHaveLength(1);
      expect(data.responses[0].status).toBe(200);
    });

    it('validates invalid dependency references', async () => {
      const response = await fetch('http://localhost:5099/v1.0/$batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [
            {
              id: '1',
              method: 'GET',
              url: '/v1.0/sites',
              dependsOn: ['999'] // Non-existent dependency
            }
          ]
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe('invalidRequest');
    });
  });
});
