import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../../src/server.js';
import { createDatabase, Database } from '../../src/services/database.js';
import * as path from 'path';
import * as fs from 'fs';

describe('Delta Queries', () => {
  const testDir = './test-tmp-delta';
  let server: MockServer;
  let db: Database;
  let driveId: string;

  beforeAll(async () => {
    // Create test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
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
    driveId = 'drive-1';

    // Create test directory structure
    const docsDir = path.join(testDir, 'sites/contoso/Documents');
    fs.mkdirSync(docsDir, { recursive: true });

    // Create test files
    fs.writeFileSync(path.join(docsDir, 'file1.txt'), 'Content 1');
    fs.writeFileSync(path.join(docsDir, 'file2.txt'), 'Content 2');
    fs.mkdirSync(path.join(docsDir, 'folder1'));
    fs.writeFileSync(path.join(docsDir, 'folder1', 'nested.txt'), 'Nested content');

    // Add files to database
    db.upsertItem({
      id: 'file-1',
      path: 'sites/contoso/Documents/file1.txt',
      type: 'file',
      parentId: 'drive-1',
      name: 'file1.txt',
      size: 9,
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z'
    });

    db.upsertItem({
      id: 'file-2',
      path: 'sites/contoso/Documents/file2.txt',
      type: 'file',
      parentId: 'drive-1',
      name: 'file2.txt',
      size: 9,
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z'
    });

    db.upsertItem({
      id: 'folder-1',
      path: 'sites/contoso/Documents/folder1',
      type: 'folder',
      parentId: 'drive-1',
      name: 'folder1',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z'
    });

    db.upsertItem({
      id: 'file-3',
      path: 'sites/contoso/Documents/folder1/nested.txt',
      type: 'file',
      parentId: 'folder-1',
      name: 'nested.txt',
      size: 14,
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z'
    });

    db.close();

    // Create mock server
    server = createMockServer({
      port: 5099,
      root: testDir,
      database: path.join(testDir, 'test.db'),
      auth: { mode: 'none' },
      logging: 'error'
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Initial sync', () => {
    it('should return all items in drive with deltaLink', async () => {
      const response = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/root/delta`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toHaveProperty('@odata.context');
      expect(body).toHaveProperty('value');
      expect(body.value).toBeInstanceOf(Array);
      expect(body.value.length).toBeGreaterThan(0);

      // Should have deltaLink on last page
      expect(body).toHaveProperty('@odata.deltaLink');
      expect(body['@odata.deltaLink']).toContain('token=');
    });

    it('should paginate with @odata.nextLink when $top is small', async () => {
      const response1 = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/root/delta?$top=2`);
      expect(response1.status).toBe(200);

      const body1 = await response1.json();
      expect(body1.value).toHaveLength(2);
      expect(body1).toHaveProperty('@odata.nextLink');
      expect(body1['@odata.nextLink']).toContain('$skiptoken=');

      // Follow nextLink
      const nextLinkUrl = new URL(body1['@odata.nextLink']);
      const response2 = await fetch(`http://localhost:5099${nextLinkUrl.pathname}${nextLinkUrl.search}`);
      expect(response2.status).toBe(200);

      const body2 = await response2.json();
      expect(body2.value.length).toBeGreaterThan(0);
    });

    it('should handle token=latest as initial sync', async () => {
      const response = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/root/delta?token=latest`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.value).toBeInstanceOf(Array);
      expect(body).toHaveProperty('@odata.deltaLink');
    });
  });

  describe('Incremental sync', () => {
    it('should return only new items since token', async () => {
      // Initial sync to get token
      const initialResp = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/root/delta`);
      expect(initialResp.status).toBe(200);
      const initial = await initialResp.json();

      const deltaLink = initial['@odata.deltaLink'];
      expect(deltaLink).toBeDefined();

      // Extract token from deltaLink
      const tokenMatch = deltaLink.match(/token=([^&]+)/);
      expect(tokenMatch).toBeTruthy();
      const token = tokenMatch[1];

      // Modify a file to trigger change
      const fileId = 'file-1';

      // Upload new content
      const putResp = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/items/${fileId}/content`, {
        method: 'PUT',
        body: 'New content for delta test'
      });
      expect(putResp.status).toBe(200);

      // Delta sync - should show the modified file
      const deltaResp = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/root/delta?token=${token}`);
      expect(deltaResp.status).toBe(200);
      const delta = await deltaResp.json();

      expect(delta.value).toBeInstanceOf(Array);
      expect(delta.value.length).toBeGreaterThan(0);

      // Should include the modified file
      const modifiedFile = delta.value.find((item: any) => item.id === fileId);
      expect(modifiedFile).toBeDefined();
    });

    it('should return deleted items with deleted facet', async () => {
      // Initial sync
      const initialResp = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/root/delta`);
      expect(initialResp.status).toBe(200);
      const initial = await initialResp.json();

      const deltaLink = initial['@odata.deltaLink'];
      const tokenMatch = deltaLink.match(/token=([^&]+)/);
      const token = tokenMatch[1];

      // Delete a file
      const fileId = 'file-2';
      const deleteResp = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/items/${fileId}`, {
        method: 'DELETE'
      });
      expect(deleteResp.status).toBe(204);

      // Delta sync - should show deleted item
      const deltaResp = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/root/delta?token=${token}`);
      expect(deltaResp.status).toBe(200);
      const delta = await deltaResp.json();

      const deletedItem = delta.value.find((item: any) => item.id === fileId);
      expect(deletedItem).toBeDefined();
      expect(deletedItem).toHaveProperty('deleted');
      expect(deletedItem.deleted).toEqual({ state: 'deleted' });
    });

    it('should return new deltaLink after incremental sync', async () => {
      const initialResp = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/root/delta`);
      expect(initialResp.status).toBe(200);
      const initial = await initialResp.json();

      const deltaLink = initial['@odata.deltaLink'];
      const tokenMatch = deltaLink.match(/token=([^&]+)/);
      const token = tokenMatch[1];

      // No changes - should still get new deltaLink
      const deltaResp = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/root/delta?token=${token}`);
      expect(deltaResp.status).toBe(200);
      const delta = await deltaResp.json();

      expect(delta).toHaveProperty('@odata.deltaLink');
      expect(delta['@odata.deltaLink']).toBeDefined();
    });

    it('should return 400 for invalid token', async () => {
      const response = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/root/delta?token=invalid-token-12345`);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBeDefined();
      expect(body.error.message).toContain('Invalid or expired delta token');
    });
  });

  describe('Folder-scoped delta', () => {
    it('should return delta for specific folder', async () => {
      const folderId = 'folder-1';

      const response = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/items/${folderId}/delta`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toHaveProperty('@odata.context');
      expect(body).toHaveProperty('value');
      expect(body).toHaveProperty('@odata.deltaLink');
    });

    it('should reject delta on non-folder items', async () => {
      const fileId = 'file-1';

      const response = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/items/${fileId}/delta`);
      expect(response.status).toBe(400);
    });
  });

  describe('Copy operation change tracking', () => {
    it('should track copied items as created', async () => {
      // Get initial delta token
      const initialResp = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/root/delta`);
      expect(initialResp.status).toBe(200);
      const initial = await initialResp.json();

      const deltaLink = initial['@odata.deltaLink'];
      const tokenMatch = deltaLink.match(/token=([^&]+)/);
      const token = tokenMatch[1];

      // Copy a file
      const sourceFileId = 'file-3';
      const copyResp = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/items/${sourceFileId}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentReference: { id: driveId },
          name: 'copied-file.txt'
        })
      });
      expect(copyResp.status).toBe(202);

      // Wait for async copy to complete
      const location = copyResp.headers.get('Location');
      expect(location).toBeDefined();

      let copyComplete = false;
      let attempts = 0;

      while (!copyComplete && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const statusResp = await fetch(`http://localhost:5099${location}`);
        const status = await statusResp.json();
        if (status.status === 'completed') {
          copyComplete = true;
        }
        attempts++;
      }

      expect(copyComplete).toBe(true);

      // Check delta - should show new file as created
      const deltaResp = await fetch(`http://localhost:5099/v1.0/drives/${driveId}/root/delta?token=${token}`);
      expect(deltaResp.status).toBe(200);
      const delta = await deltaResp.json();

      expect(delta.value.length).toBeGreaterThan(0);
      const copiedItem = delta.value.find((item: any) => item.name === 'copied-file.txt');
      expect(copiedItem).toBeDefined();
    });
  });
});
