import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../../src/server.js';
import { createDatabase, Database } from '../../src/services/database.js';
import { FilesystemService } from '../../src/services/filesystem.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Drives Routes', () => {
  const testDir = './test-tmp-drives';
  let server: MockServer;
  let db: Database;
  let fsService: FilesystemService;

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
    fs.writeFileSync(path.join(docsDir, 'test.txt'), 'Hello World');

    db.upsertItem({
      id: 'file-1',
      path: 'sites/contoso/Documents/test.txt',
      type: 'file',
      parentId: 'drive-1',
      name: 'test.txt',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z',
      size: 11
    });

    // Create a subfolder
    db.upsertItem({
      id: 'folder-1',
      path: 'sites/contoso/Documents/Reports',
      type: 'folder',
      parentId: 'drive-1',
      name: 'Reports',
      createdAt: '2024-01-02T00:00:00Z',
      modifiedAt: '2024-01-02T00:00:00Z'
    });

    db.close();

    server = createMockServer({
      port: 5098,
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

  it('GET /v1.0/sites/:siteId/drives returns all drives', async () => {
    const response = await fetch('http://localhost:5098/v1.0/sites/site-1/drives');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('@odata.context');
    expect(data).toHaveProperty('value');
    expect(Array.isArray(data.value)).toBe(true);
    expect(data.value.length).toBeGreaterThanOrEqual(1);

    const drive = data.value.find((d: any) => d.id === 'drive-1');
    expect(drive).toBeDefined();
    expect(drive.name).toBe('Documents');
  });

  it('GET /v1.0/sites/:siteId/drives/drive returns default drive', async () => {
    const response = await fetch('http://localhost:5098/v1.0/sites/site-1/drives/drive');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('name');
  });

  it('GET /v1.0/drives/:driveId/root/children returns 2 items', async () => {
    const response = await fetch('http://localhost:5098/v1.0/drives/drive-1/root/children');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('@odata.context');
    expect(data).toHaveProperty('value');
    expect(Array.isArray(data.value)).toBe(true);
    expect(data.value).toHaveLength(2);

    const names = data.value.map((item: any) => item.name).sort();
    expect(names).toEqual(['Reports', 'test.txt']);
  });

  it('GET /v1.0/drives/:driveId/items/:itemId returns item by ID', async () => {
    const response = await fetch('http://localhost:5098/v1.0/drives/drive-1/items/file-1');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('id', 'file-1');
    expect(data).toHaveProperty('name', 'test.txt');
  });

  it('GET /v1.0/drives/:driveId/items/:itemId/children returns folder contents', async () => {
    const response = await fetch('http://localhost:5098/v1.0/drives/drive-1/items/drive-1/children');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('value');
    expect(Array.isArray(data.value)).toBe(true);
  });

  it('GET /v1.0/drives/:driveId/items/:itemId/content returns file content', async () => {
    const response = await fetch('http://localhost:5098/v1.0/drives/drive-1/items/file-1/content');
    expect(response.status).toBe(200);

    const content = await response.text();
    expect(content).toBe('Hello World');
  });

  it('PUT /v1.0/drives/:driveId/items/:itemId/content updates file', async () => {
    const newContent = 'Updated content';
    const response = await fetch('http://localhost:5098/v1.0/drives/drive-1/items/file-1/content', {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: newContent
    });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('id', 'file-1');
    expect(data).toHaveProperty('name', 'test.txt');

    // Verify file was actually updated
    const getResponse = await fetch('http://localhost:5098/v1.0/drives/drive-1/items/file-1/content');
    const content = await getResponse.text();
    expect(content).toBe(newContent);
  });

  it('DELETE /v1.0/drives/:driveId/items/:itemId deletes item', async () => {
    const response = await fetch('http://localhost:5098/v1.0/drives/drive-1/items/file-1', {
      method: 'DELETE'
    });
    expect(response.status).toBe(204);

    // Verify item was deleted
    const getResponse = await fetch('http://localhost:5098/v1.0/drives/drive-1/items/file-1');
    expect(getResponse.status).toBe(404);
  });
});
