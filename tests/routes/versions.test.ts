import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../../src/server.js';
import { createDatabase, Database } from '../../src/services/database.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Versions Routes', () => {
  const testDir = './test-tmp-versions';
  let server: MockServer;
  let db: Database;

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

    // Create test library
    db.upsertItem({
      id: 'drive-1',
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
    fs.writeFileSync(path.join(docsDir, 'test.txt'), 'Original content');

    db.upsertItem({
      id: 'file-1',
      path: 'sites/contoso/Documents/test.txt',
      type: 'file',
      parentId: 'drive-1',
      name: 'test.txt',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z',
      size: 16
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

  it('GET /versions returns empty array for new file', async () => {
    const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/versions');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('@odata.context');
    expect(data).toHaveProperty('value');
    expect(Array.isArray(data.value)).toBe(true);
    expect(data.value.length).toBe(0);
  });

  it('PUT /content creates a version', async () => {
    // Update file content
    const updateResponse = await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/content', {
      method: 'PUT',
      body: 'Updated content v1',
      headers: {
        'Content-Type': 'text/plain'
      }
    });
    expect(updateResponse.status).toBe(200);

    // Check versions
    const versionsResponse = await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/versions');
    expect(versionsResponse.status).toBe(200);

    const data = await versionsResponse.json();
    expect(data.value.length).toBe(1);
    expect(data.value[0].id).toBe('1.0');
    expect(data.value[0].size).toBe(16); // Original content size
  });

  it('Multiple updates create multiple versions', async () => {
    // Second update
    await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/content', {
      method: 'PUT',
      body: 'Updated content v2',
      headers: {
        'Content-Type': 'text/plain'
      }
    });

    // Third update
    await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/content', {
      method: 'PUT',
      body: 'Updated content v3',
      headers: {
        'Content-Type': 'text/plain'
      }
    });

    // Check versions
    const versionsResponse = await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/versions');
    expect(versionsResponse.status).toBe(200);

    const data = await versionsResponse.json();
    expect(data.value.length).toBe(3);
    expect(data.value[0].id).toBe('3.0'); // Latest version first
    expect(data.value[1].id).toBe('2.0');
    expect(data.value[2].id).toBe('1.0');
  });

  it('GET /versions/:versionId returns specific version', async () => {
    const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/versions/1.0');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.id).toBe('1.0');
    expect(data.size).toBe(16);
    expect(data).toHaveProperty('lastModifiedDateTime');
    expect(data).toHaveProperty('lastModifiedBy');
  });

  it('GET /versions/:versionId/content downloads version content', async () => {
    const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/versions/1.0/content');
    expect(response.status).toBe(200);

    const content = await response.text();
    expect(content).toBe('Original content');
  });

  it('POST /restoreVersion restores previous version', async () => {
    // Restore version 1.0
    const restoreResponse = await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/versions/1.0/restoreVersion', {
      method: 'POST'
    });
    expect(restoreResponse.status).toBe(204);

    // Check current content
    const contentResponse = await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/content');
    const content = await contentResponse.text();
    expect(content).toBe('Original content');

    // Should have one more version (the restore creates a new version)
    const versionsResponse = await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/versions');
    const data = await versionsResponse.json();
    expect(data.value.length).toBe(4); // Now we have 3 + 1 from restore
  });

  it('DELETE /versions/:versionId deletes a version', async () => {
    const deleteResponse = await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/versions/1.0', {
      method: 'DELETE'
    });
    expect(deleteResponse.status).toBe(204);

    // Verify version is gone
    const checkResponse = await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/versions/1.0');
    expect(checkResponse.status).toBe(404);

    // Should have one less version
    const versionsResponse = await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/versions');
    const data = await versionsResponse.json();
    expect(data.value.length).toBe(3);
  });

  it('GET /versions for non-existent item returns 404', async () => {
    const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/items/nonexistent/versions');
    expect(response.status).toBe(404);
  });

  it('GET /versions/:versionId for non-existent version returns 404', async () => {
    const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/versions/99.0');
    expect(response.status).toBe(404);
  });

  it('POST /restoreVersion for non-existent version returns 404', async () => {
    const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/items/file-1/versions/99.0/restoreVersion', {
      method: 'POST'
    });
    expect(response.status).toBe(404);
  });
});
