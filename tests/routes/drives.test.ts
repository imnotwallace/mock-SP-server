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

describe('Drives Routes - Enhanced Metadata', () => {
  const testDir = './test-tmp-drives-meta';
  let server: MockServer;
  let db: Database;
  let fsService: FilesystemService;
  const PORT = 5099;

  beforeAll(async () => {
    // Clean up from any previous run
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });

    // Create directory structure that fsService will scan
    const dataDir = path.join(testDir, 'data/contoso/main/Documents');
    fs.mkdirSync(dataDir, { recursive: true });

    // Create _site.json for site collection
    fs.writeFileSync(
      path.join(testDir, 'data/contoso/_site.json'),
      JSON.stringify({ displayName: 'Contoso' })
    );

    // Create test file
    fs.writeFileSync(path.join(dataDir, 'test.txt'), 'Hello World');

    // Create _files.json with metadata
    fs.writeFileSync(
      path.join(dataDir, '_files.json'),
      JSON.stringify({
        'test.txt': {
          fields: { Department: 'Sales', Priority: 'High' }
        }
      })
    );

    // Initialize database and filesystem service
    db = createDatabase(path.join(testDir, 'test.db'));
    fsService = new FilesystemService(path.join(testDir, 'data'), db);

    // Scan to populate database
    fsService.scan();

    // Keep db open for the server
    db.close();

    // Start server
    server = createMockServer({
      port: PORT,
      root: path.join(testDir, 'data'),
      auth: { mode: 'none' },
      database: path.join(testDir, 'test.db'),
      logging: 'error'
    });
    await server.start();

    // Re-open db for test assertions
    db = createDatabase(path.join(testDir, 'test.db'));
  });

  afterAll(async () => {
    await server.stop();
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('returns enhanced file metadata with file object', async () => {
    // Get a file's ID from db
    const files = db.getItemsByType('file');
    expect(files.length).toBeGreaterThan(0);
    const fileId = files[0].id;
    const driveId = files[0].parentId;

    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/${driveId}/items/${fileId}`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.file).toBeDefined();
    expect(data.file.mimeType).toBe('text/plain');
    expect(data.createdDateTime).toBeDefined();
    expect(data.lastModifiedDateTime).toBeDefined();
  });

  it('returns fields when $expand=fields is used', async () => {
    const files = db.getItemsByType('file');
    expect(files.length).toBeGreaterThan(0);
    const fileId = files[0].id;
    const driveId = files[0].parentId;

    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/${driveId}/items/${fileId}?$expand=fields`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.fields).toBeDefined();
    expect(data.fields.Department).toBe('Sales');
    expect(data.fields.Priority).toBe('High');
  });
});

describe('Drives Routes - $filter', () => {
  const testDir = './test-tmp-drives-filter';
  let server: MockServer;
  let db: Database;
  const PORT = 5100;

  beforeAll(async () => {
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

    // Create test library (drive)
    db.upsertItem({
      id: 'drive-1',
      path: 'sites/contoso/Documents',
      type: 'library',
      parentId: 'site-1',
      name: 'Documents',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z'
    });

    // Create test files with different properties
    const docsDir = path.join(testDir, 'sites/contoso/Documents');
    fs.mkdirSync(docsDir, { recursive: true });

    fs.writeFileSync(path.join(docsDir, 'report.pdf'), 'PDF content');
    db.upsertItem({
      id: 'file-1',
      path: 'sites/contoso/Documents/report.pdf',
      type: 'file',
      parentId: 'drive-1',
      name: 'report.pdf',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z',
      size: 1000
    });

    fs.writeFileSync(path.join(docsDir, 'notes.txt'), 'Text content');
    db.upsertItem({
      id: 'file-2',
      path: 'sites/contoso/Documents/notes.txt',
      type: 'file',
      parentId: 'drive-1',
      name: 'notes.txt',
      createdAt: '2024-02-01T00:00:00Z',
      modifiedAt: '2024-02-01T00:00:00Z',
      size: 500
    });

    fs.writeFileSync(path.join(docsDir, 'data.xlsx'), 'Excel content');
    db.upsertItem({
      id: 'file-3',
      path: 'sites/contoso/Documents/data.xlsx',
      type: 'file',
      parentId: 'drive-1',
      name: 'data.xlsx',
      createdAt: '2024-03-01T00:00:00Z',
      modifiedAt: '2024-03-01T00:00:00Z',
      size: 2000
    });

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

  it('filters by name equality', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root/children?$filter=name eq 'report.pdf'`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.value).toHaveLength(1);
    expect(data.value[0].name).toBe('report.pdf');
  });

  it('filters by size greater than', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root/children?$filter=size gt 800`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.value).toHaveLength(2);
    const names = data.value.map((i: any) => i.name).sort();
    expect(names).toEqual(['data.xlsx', 'report.pdf']);
  });

  it('filters with AND operator', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root/children?$filter=size gt 400 and size lt 1500`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.value).toHaveLength(2);
    const names = data.value.map((i: any) => i.name).sort();
    expect(names).toEqual(['notes.txt', 'report.pdf']);
  });

  it('filters with OR operator', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root/children?$filter=name eq 'report.pdf' or name eq 'notes.txt'`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.value).toHaveLength(2);
  });

  it('filters using startswith function', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root/children?$filter=startswith(name, 'rep')`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.value).toHaveLength(1);
    expect(data.value[0].name).toBe('report.pdf');
  });

  it('filters using endswith function', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root/children?$filter=endswith(name, '.txt')`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.value).toHaveLength(1);
    expect(data.value[0].name).toBe('notes.txt');
  });

  it('filters using contains function', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root/children?$filter=contains(name, 'data')`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.value).toHaveLength(1);
    expect(data.value[0].name).toBe('data.xlsx');
  });

  it('returns empty array when no matches', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root/children?$filter=name eq 'nonexistent.file'`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.value).toHaveLength(0);
  });

  it('combines $filter with $top pagination', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/root/children?$filter=size gt 400&$top=1`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.value).toHaveLength(1);
  });
});

describe('Drives Routes - Copy Operations', () => {
  const testDir = './test-tmp-drives-copy';
  let server: MockServer;
  let db: Database;
  const PORT = 5101;

  beforeAll(async () => {
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

    // Create test library (drive)
    db.upsertItem({
      id: 'drive-1',
      path: 'sites/contoso/Documents',
      type: 'library',
      parentId: 'site-1',
      name: 'Documents',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z'
    });

    // Create test files and folders
    const docsDir = path.join(testDir, 'sites/contoso/Documents');
    fs.mkdirSync(docsDir, { recursive: true });

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

    // Create target folder
    const targetDir = path.join(docsDir, 'Target');
    fs.mkdirSync(targetDir, { recursive: true });
    db.upsertItem({
      id: 'folder-1',
      path: 'sites/contoso/Documents/Target',
      type: 'folder',
      parentId: 'drive-1',
      name: 'Target',
      createdAt: '2024-01-02T00:00:00Z',
      modifiedAt: '2024-01-02T00:00:00Z'
    });

    // Create folder with children for recursive copy test
    const sourceDir = path.join(docsDir, 'SourceFolder');
    fs.mkdirSync(sourceDir, { recursive: true });
    db.upsertItem({
      id: 'folder-2',
      path: 'sites/contoso/Documents/SourceFolder',
      type: 'folder',
      parentId: 'drive-1',
      name: 'SourceFolder',
      createdAt: '2024-01-03T00:00:00Z',
      modifiedAt: '2024-01-03T00:00:00Z'
    });

    fs.writeFileSync(path.join(sourceDir, 'child.txt'), 'Child content');
    db.upsertItem({
      id: 'file-2',
      path: 'sites/contoso/Documents/SourceFolder/child.txt',
      type: 'file',
      parentId: 'folder-2',
      name: 'child.txt',
      createdAt: '2024-01-03T00:00:00Z',
      modifiedAt: '2024-01-03T00:00:00Z',
      size: 13
    });

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

  it('POST /copy returns 202 with Location header', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/file-1/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentReference: { id: 'folder-1' },
        name: 'copied-test.txt'
      })
    });

    expect(response.status).toBe(202);
    expect(response.headers.get('location')).toMatch(/\/operations\//);
  });

  it('Operation monitor returns completed status', async () => {
    const copyResponse = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/file-1/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentReference: { id: 'folder-1' },
        name: 'monitor-test.txt'
      })
    });

    const location = copyResponse.headers.get('location');
    expect(location).toBeTruthy();

    // Wait a bit for async operation to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    const monitorResponse = await fetch(`http://localhost:${PORT}${location}`);
    expect(monitorResponse.status).toBe(200);

    const data = await monitorResponse.json();
    expect(data.status).toBe('completed');
    expect(data.resourceId).toBeDefined();
  });

  it('Copy with conflictBehavior=fail returns 409 when name exists', async () => {
    // First copy
    await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/file-1/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentReference: { id: 'folder-1' },
        name: 'conflict-test.txt'
      })
    });

    // Wait for completion
    await new Promise(resolve => setTimeout(resolve, 100));

    // Second copy with same name (default fail behavior)
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/file-1/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentReference: { id: 'folder-1' },
        name: 'conflict-test.txt'
      })
    });

    expect(response.status).toBe(409);
  });

  it('Copy with conflictBehavior=rename generates unique name', async () => {
    // First copy
    const firstResponse = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/file-1/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentReference: { id: 'folder-1' },
        name: 'rename-test.txt'
      })
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    // Second copy with rename behavior
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/file-1/copy?@microsoft.graph.conflictBehavior=rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentReference: { id: 'folder-1' },
        name: 'rename-test.txt'
      })
    });

    expect(response.status).toBe(202);

    const location = response.headers.get('location');
    await new Promise(resolve => setTimeout(resolve, 100));

    const monitorResponse = await fetch(`http://localhost:${PORT}${location}`);
    const data = await monitorResponse.json();
    expect(data.status).toBe('completed');
    expect(data.resourceId).toBeDefined();

    // Verify the new item has a unique name
    const itemResponse = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/${data.resourceId}`);
    const item = await itemResponse.json();
    expect(item.name).toMatch(/rename-test \(\d+\)\.txt/);
  });

  it('Copies folder recursively with children', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/folder-2/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentReference: { id: 'folder-1' },
        name: 'CopiedFolder'
      })
    });

    expect(response.status).toBe(202);

    const location = response.headers.get('location');
    await new Promise(resolve => setTimeout(resolve, 150));

    const monitorResponse = await fetch(`http://localhost:${PORT}${location}`);
    const data = await monitorResponse.json();
    expect(data.status).toBe('completed');
    expect(data.resourceId).toBeDefined();

    // Verify folder was created
    const folderResponse = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/${data.resourceId}`);
    const folder = await folderResponse.json();
    expect(folder.name).toBe('CopiedFolder');

    // Verify children were copied
    const childrenResponse = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/${data.resourceId}/children`);
    const children = await childrenResponse.json();
    expect(children.value).toHaveLength(1);
    expect(children.value[0].name).toBe('child.txt');
  });
});

describe('Drives Routes - Move Operations', () => {
  const testDir = './test-tmp-drives-move';
  let server: MockServer;
  let db: Database;
  const PORT = 5102;

  beforeAll(async () => {
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

    // Create test library (drive)
    db.upsertItem({
      id: 'drive-1',
      path: 'sites/contoso/Documents',
      type: 'library',
      parentId: 'site-1',
      name: 'Documents',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z'
    });

    // Create test files and folders
    const docsDir = path.join(testDir, 'sites/contoso/Documents');
    fs.mkdirSync(docsDir, { recursive: true });

    fs.writeFileSync(path.join(docsDir, 'moveme.txt'), 'Move me');
    db.upsertItem({
      id: 'file-1',
      path: 'sites/contoso/Documents/moveme.txt',
      type: 'file',
      parentId: 'drive-1',
      name: 'moveme.txt',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z',
      size: 7
    });

    fs.writeFileSync(path.join(docsDir, 'renameme.txt'), 'Rename me');
    db.upsertItem({
      id: 'file-2',
      path: 'sites/contoso/Documents/renameme.txt',
      type: 'file',
      parentId: 'drive-1',
      name: 'renameme.txt',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z',
      size: 9
    });

    // Create target folder
    const targetDir = path.join(docsDir, 'MoveTarget');
    fs.mkdirSync(targetDir, { recursive: true });
    db.upsertItem({
      id: 'folder-1',
      path: 'sites/contoso/Documents/MoveTarget',
      type: 'folder',
      parentId: 'drive-1',
      name: 'MoveTarget',
      createdAt: '2024-01-02T00:00:00Z',
      modifiedAt: '2024-01-02T00:00:00Z'
    });

    // Create folder with children for move test
    const sourceDir = path.join(docsDir, 'FolderToMove');
    fs.mkdirSync(sourceDir, { recursive: true });
    db.upsertItem({
      id: 'folder-2',
      path: 'sites/contoso/Documents/FolderToMove',
      type: 'folder',
      parentId: 'drive-1',
      name: 'FolderToMove',
      createdAt: '2024-01-03T00:00:00Z',
      modifiedAt: '2024-01-03T00:00:00Z'
    });

    fs.writeFileSync(path.join(sourceDir, 'nested.txt'), 'Nested file');
    db.upsertItem({
      id: 'file-3',
      path: 'sites/contoso/Documents/FolderToMove/nested.txt',
      type: 'file',
      parentId: 'folder-2',
      name: 'nested.txt',
      createdAt: '2024-01-03T00:00:00Z',
      modifiedAt: '2024-01-03T00:00:00Z',
      size: 11
    });

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

  it('PATCH with parentReference moves item', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/file-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentReference: { id: 'folder-1' }
      })
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.parentReference.id).toBe('folder-1');
    expect(data.name).toBe('moveme.txt');
  });

  it('PATCH with name renames item', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/file-2`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'renamed.txt'
      })
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.name).toBe('renamed.txt');
    expect(data.id).toBe('file-2');
  });

  it('PATCH with parentReference and name moves and renames', async () => {
    // Create a new test file for this test
    const docsDir = path.join(testDir, 'sites/contoso/Documents');
    fs.writeFileSync(path.join(docsDir, 'moveandrename.txt'), 'Move and rename');

    const db2 = createDatabase(path.join(testDir, 'test.db'));
    db2.upsertItem({
      id: 'file-4',
      path: 'sites/contoso/Documents/moveandrename.txt',
      type: 'file',
      parentId: 'drive-1',
      name: 'moveandrename.txt',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z',
      size: 15
    });
    db2.close();

    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/file-4`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentReference: { id: 'folder-1' },
        name: 'movedandrenamed.txt'
      })
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.name).toBe('movedandrenamed.txt');
    expect(data.parentReference.id).toBe('folder-1');
  });

  it('Move folder updates all descendant paths', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/folder-2`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentReference: { id: 'folder-1' }
      })
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.parentReference.id).toBe('folder-1');

    // Verify children still accessible
    const childrenResponse = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/folder-2/children`);
    expect(childrenResponse.status).toBe(200);

    const children = await childrenResponse.json();
    expect(children.value).toHaveLength(1);
    expect(children.value[0].name).toBe('nested.txt');
  });

  it('PATCH returns 404 for non-existent item', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/non-existent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'newname.txt'
      })
    });

    expect(response.status).toBe(404);
  });

  it('PATCH returns 400 when target is not a folder', async () => {
    const response = await fetch(`http://localhost:${PORT}/v1.0/drives/drive-1/items/file-2`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentReference: { id: 'file-1' }  // file-1 is a file, not a folder
      })
    });

    expect(response.status).toBe(400);
  });
});
