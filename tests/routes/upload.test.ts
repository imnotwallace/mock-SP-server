import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../../src/server.js';
import { createDatabase, Database } from '../../src/services/database.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Large File Upload Sessions', () => {
  const testDir = './test-tmp-upload';
  const PORT = 5097;
  const CHUNK_SIZE = 320 * 1024; // 320 KB
  let server: MockServer;
  let db: Database;

  beforeAll(async () => {
    // Clean up from previous run
    fs.rmSync(testDir, { recursive: true, force: true });
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
    db.upsertItem({
      id: 'drive-1',
      path: 'sites/contoso/Documents',
      type: 'library',
      parentId: 'site-1',
      name: 'Documents',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z'
    });

    // Create library directory
    const docsDir = path.join(testDir, 'sites/contoso/Documents');
    fs.mkdirSync(docsDir, { recursive: true });

    db.close();

    server = createMockServer({
      port: PORT,
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

  describe('POST createUploadSession', () => {
    it('creates upload session for new file', async () => {
      const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root:/largefile.zip:/createUploadSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: {
            '@microsoft.graph.conflictBehavior': 'rename'
          }
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uploadUrl');
      expect(data).toHaveProperty('expirationDateTime');
      expect(data).toHaveProperty('nextExpectedRanges');
      expect(data.nextExpectedRanges).toEqual(['0-']);
    });

    it('creates upload session with parent ID syntax', async () => {
      const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/root:/testfile.txt:/createUploadSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: {
            '@microsoft.graph.conflictBehavior': 'fail'
          }
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('uploadUrl');
      expect(data.uploadUrl).toContain('/upload/sessions/');
    });
  });

  describe('PUT uploadUrl - Single chunk upload', () => {
    it('uploads file in single chunk', async () => {
      // Create session
      const sessionResponse = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root:/singlefile.txt:/createUploadSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: { '@microsoft.graph.conflictBehavior': 'rename' }
        })
      });
      const session = await sessionResponse.json();
      const uploadUrl = new URL(session.uploadUrl).pathname;

      // Upload content
      const content = Buffer.alloc(CHUNK_SIZE, 'x');
      const uploadResponse = await fetch(`http://localhost:${PORT}${uploadUrl}`, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes 0-${CHUNK_SIZE - 1}/${CHUNK_SIZE}`
        },
        body: content
      });

      expect(uploadResponse.status).toBe(201);
      const item = await uploadResponse.json();
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name');
      expect(item.size).toBe(CHUNK_SIZE);
    });
  });

  describe('PUT uploadUrl - Multiple chunks', () => {
    it('uploads file in multiple chunks', async () => {
      // Create session
      const sessionResponse = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root:/multifile.dat:/createUploadSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: { '@microsoft.graph.conflictBehavior': 'rename' }
        })
      });
      const session = await sessionResponse.json();
      const uploadUrl = new URL(session.uploadUrl).pathname;

      const totalSize = CHUNK_SIZE * 3;

      // Upload chunk 1
      let chunk = Buffer.alloc(CHUNK_SIZE, 'a');
      let response = await fetch(`http://localhost:${PORT}${uploadUrl}`, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes 0-${CHUNK_SIZE - 1}/${totalSize}`
        },
        body: chunk
      });

      expect(response.status).toBe(202);
      let data = await response.json();
      expect(data.nextExpectedRanges).toContain(`${CHUNK_SIZE}-`);

      // Upload chunk 2
      chunk = Buffer.alloc(CHUNK_SIZE, 'b');
      response = await fetch(`http://localhost:${PORT}${uploadUrl}`, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${CHUNK_SIZE}-${CHUNK_SIZE * 2 - 1}/${totalSize}`
        },
        body: chunk
      });

      expect(response.status).toBe(202);
      data = await response.json();
      expect(data.nextExpectedRanges).toContain(`${CHUNK_SIZE * 2}-`);

      // Upload chunk 3 (final)
      chunk = Buffer.alloc(CHUNK_SIZE, 'c');
      response = await fetch(`http://localhost:${PORT}${uploadUrl}`, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${CHUNK_SIZE * 2}-${totalSize - 1}/${totalSize}`
        },
        body: chunk
      });

      expect(response.status).toBe(201);
      const item = await response.json();
      expect(item.size).toBe(totalSize);
      expect(item).toHaveProperty('name', 'multifile.dat');
    });

    it('handles out-of-order chunks', async () => {
      // Create session
      const sessionResponse = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root:/outoforder.dat:/createUploadSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: { '@microsoft.graph.conflictBehavior': 'rename' }
        })
      });
      const session = await sessionResponse.json();
      const uploadUrl = new URL(session.uploadUrl).pathname;

      const totalSize = CHUNK_SIZE * 2;

      // Upload chunk 2 first
      let chunk = Buffer.alloc(CHUNK_SIZE, 'b');
      let response = await fetch(`http://localhost:${PORT}${uploadUrl}`, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${CHUNK_SIZE}-${CHUNK_SIZE * 2 - 1}/${totalSize}`
        },
        body: chunk
      });

      expect(response.status).toBe(202);
      let data = await response.json();
      expect(data.nextExpectedRanges).toContain('0-');

      // Upload chunk 1
      chunk = Buffer.alloc(CHUNK_SIZE, 'a');
      response = await fetch(`http://localhost:${PORT}${uploadUrl}`, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes 0-${CHUNK_SIZE - 1}/${totalSize}`
        },
        body: chunk
      });

      expect(response.status).toBe(201);
      const item = await response.json();
      expect(item.size).toBe(totalSize);
    });
  });

  describe('GET uploadUrl - Session status', () => {
    it('returns session status', async () => {
      // Create session
      const sessionResponse = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root:/statustest.dat:/createUploadSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: { '@microsoft.graph.conflictBehavior': 'rename' }
        })
      });
      const session = await sessionResponse.json();
      const uploadUrl = new URL(session.uploadUrl).pathname;

      const totalSize = CHUNK_SIZE * 2;

      // Upload first chunk
      const chunk = Buffer.alloc(CHUNK_SIZE, 'x');
      await fetch(`http://localhost:${PORT}${uploadUrl}`, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes 0-${CHUNK_SIZE - 1}/${totalSize}`
        },
        body: chunk
      });

      // Check status
      const statusResponse = await fetch(`http://localhost:${PORT}${uploadUrl}`);
      expect(statusResponse.status).toBe(200);

      const status = await statusResponse.json();
      expect(status.nextExpectedRanges).toContain(`${CHUNK_SIZE}-`);
      expect(status).toHaveProperty('expirationDateTime');
    });
  });

  describe('DELETE uploadUrl - Cancel session', () => {
    it('cancels upload session', async () => {
      // Create session
      const sessionResponse = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root:/canceltest.dat:/createUploadSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: { '@microsoft.graph.conflictBehavior': 'rename' }
        })
      });
      const session = await sessionResponse.json();
      const uploadUrl = new URL(session.uploadUrl).pathname;

      // Cancel session
      const cancelResponse = await fetch(`http://localhost:${PORT}${uploadUrl}`, {
        method: 'DELETE'
      });
      expect(cancelResponse.status).toBe(204);

      // Session should be gone
      const checkResponse = await fetch(`http://localhost:${PORT}${uploadUrl}`);
      expect(checkResponse.status).toBe(404);
    });
  });

  describe('Error handling', () => {
    it('rejects invalid Content-Range header', async () => {
      const sessionResponse = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root:/badrange.dat:/createUploadSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: { '@microsoft.graph.conflictBehavior': 'rename' }
        })
      });
      const session = await sessionResponse.json();
      const uploadUrl = new URL(session.uploadUrl).pathname;

      const chunk = Buffer.alloc(100, 'x');
      const response = await fetch(`http://localhost:${PORT}${uploadUrl}`, {
        method: 'PUT',
        headers: {
          'Content-Range': 'invalid-range'
        },
        body: chunk
      });

      expect(response.status).toBe(400);
    });

    it('rejects upload to expired session', async () => {
      const uploadUrl = '/upload/sessions/invalid-session-id';
      const chunk = Buffer.alloc(100, 'x');

      const response = await fetch(`http://localhost:${PORT}${uploadUrl}`, {
        method: 'PUT',
        headers: {
          'Content-Range': 'bytes 0-99/100'
        },
        body: chunk
      });

      expect(response.status).toBe(404);
    });
  });
});
