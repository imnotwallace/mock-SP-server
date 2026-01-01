import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../../src/server.js';
import { createDatabase, Database } from '../../src/services/database.js';
import { FilesystemService } from '../../src/services/filesystem.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Lists Routes', () => {
  const testDir = './test-tmp-lists';
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

    // Create test library (Documents)
    db.upsertItem({
      id: 'library-1',
      path: 'sites/contoso/Documents',
      type: 'library',
      parentId: 'site-1',
      name: 'Documents',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z'
    });

    // Create test list (Tasks)
    db.upsertItem({
      id: 'list-1',
      path: 'sites/contoso/Tasks',
      type: 'list',
      parentId: 'site-1',
      name: 'Tasks',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z'
    });

    // Create test files in library
    db.upsertItem({
      id: 'file-1',
      path: 'sites/contoso/Documents/report.docx',
      type: 'file',
      parentId: 'library-1',
      name: 'report.docx',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z',
      size: 1024
    });

    db.upsertItem({
      id: 'file-2',
      path: 'sites/contoso/Documents/notes.txt',
      type: 'file',
      parentId: 'library-1',
      name: 'notes.txt',
      createdAt: '2024-01-02T00:00:00Z',
      modifiedAt: '2024-01-02T00:00:00Z',
      size: 512
    });

    // Create filesystem structure for list items
    fs.mkdirSync(path.join(testDir, 'sites/contoso/Tasks'), { recursive: true });
    
    // Create list items
    fsService = new FilesystemService(testDir, db);
    fsService.saveListItems('sites/contoso/Tasks', [
      {
        id: 'item-1',
        title: 'Task 1',
        status: 'Not Started',
        createdAt: '2024-01-01T00:00:00Z'
      },
      {
        id: 'item-2',
        title: 'Task 2',
        status: 'In Progress',
        createdAt: '2024-01-02T00:00:00Z'
      }
    ]);

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

  it('GET /v1.0/sites/:siteId/lists returns all lists and libraries', async () => {
    const response = await fetch('http://localhost:5099/v1.0/sites/site-1/lists');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('@odata.context');
    expect(data).toHaveProperty('value');
    expect(Array.isArray(data.value)).toBe(true);
    expect(data.value).toHaveLength(2);
    
    const listNames = data.value.map((l: any) => l.name).sort();
    expect(listNames).toEqual(['Documents', 'Tasks']);
  });

  it('GET /v1.0/sites/:siteId/lists/:listId returns list by ID', async () => {
    const response = await fetch('http://localhost:5099/v1.0/sites/site-1/lists/library-1');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('id', 'library-1');
    expect(data).toHaveProperty('name', 'Documents');
    expect(data).toHaveProperty('type', 'library');
  });

  it('GET /v1.0/sites/:siteId/lists/:listId/items returns library items (files)', async () => {
    const response = await fetch('http://localhost:5099/v1.0/sites/site-1/lists/library-1/items');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('@odata.context');
    expect(data).toHaveProperty('value');
    expect(Array.isArray(data.value)).toBe(true);
    expect(data.value).toHaveLength(2);
    
    const fileNames = data.value.map((f: any) => f.name).sort();
    expect(fileNames).toEqual(['notes.txt', 'report.docx']);
  });
});
