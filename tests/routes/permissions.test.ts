import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../../src/server.js';
import { createDatabase, Database } from '../../src/services/database.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Permissions API', () => {
  const testDir = './test-tmp-permissions';
  let server: MockServer;
  let driveId: string;
  let itemId: string;

  beforeAll(async () => {
    fs.mkdirSync(testDir, { recursive: true });

    const db = createDatabase(path.join(testDir, 'test.db'));

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

    // Create test file
    itemId = 'file-1';
    db.upsertItem({
      id: itemId,
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
      port: 5097,
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

  describe('GET /drives/{id}/items/{id}/permissions', () => {
    it('should return empty permissions list for item without permissions', async () => {
      const response = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/permissions`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('value');
      expect(Array.isArray(data.value)).toBe(true);
    });

    it('should return 404 for non-existent item', async () => {
      const response = await fetch('http://localhost:5097/v1.0/drives/fake-drive/items/fake-item/permissions');
      expect(response.status).toBe(404);
    });
  });

  describe('POST /drives/{id}/items/{id}/createLink', () => {
    it('should create anonymous view link', async () => {
      const response = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/createLink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'view', scope: 'anonymous' })
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.id).toBeDefined();
      expect(data.roles).toContain('read');
      expect(data.link).toBeDefined();
      expect(data.link.type).toBe('view');
      expect(data.link.scope).toBe('anonymous');
      expect(data.link.webUrl).toBeDefined();
    });

    it('should create edit link with expiration', async () => {
      const response = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/createLink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'edit',
          scope: 'organization',
          expirationDateTime: '2025-12-31T23:59:59Z'
        })
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.roles).toContain('write');
      expect(data.link.type).toBe('edit');
      expect(data.expirationDateTime).toBe('2025-12-31T23:59:59Z');
    });

    it('should return 400 when type is missing', async () => {
      const response = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/createLink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'anonymous' })
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /drives/{id}/items/{id}/invite', () => {
    it('should invite user with read access', async () => {
      const response = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: [{ email: 'guest@example.com' }],
          roles: ['read']
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.value).toBeInstanceOf(Array);
      expect(data.value.length).toBe(1);
      expect(data.value[0].grantedTo.user.email).toBe('guest@example.com');
      expect(data.value[0].roles).toContain('read');
    });

    it('should invite multiple users', async () => {
      const response = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: [
            { email: 'user1@example.com' },
            { email: 'user2@example.com' }
          ],
          roles: ['write']
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.value.length).toBe(2);
      expect(data.value[0].roles).toContain('write');
    });

    it('should return 400 when recipients are missing', async () => {
      const response = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: ['read'] })
      });

      expect(response.status).toBe(400);
    });
  });

  describe('PATCH /drives/{id}/items/{id}/permissions/{id}', () => {
    it('should update permission roles', async () => {
      // Create a permission first
      const createResponse = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: [{ email: 'updatetest@example.com' }],
          roles: ['read']
        })
      });
      const createData = await createResponse.json();
      const permId = createData.value[0].id;

      // Update it
      const response = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/permissions/${permId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: ['write'] })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.roles).toContain('write');
    });

    it('should return 404 for non-existent permission', async () => {
      const response = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/permissions/fake-perm-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: ['write'] })
      });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /drives/{id}/items/{id}/permissions/{id}', () => {
    it('should delete permission', async () => {
      // Create a permission first
      const createResponse = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: [{ email: 'deletetest@example.com' }],
          roles: ['read']
        })
      });
      const createData = await createResponse.json();
      const permId = createData.value[0].id;

      // Delete it
      const response = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/permissions/${permId}`, {
        method: 'DELETE'
      });

      expect(response.status).toBe(204);

      // Verify it's gone
      const checkResponse = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/permissions/${permId}`);
      expect(checkResponse.status).toBe(404);
    });

    it('should return 404 for non-existent permission', async () => {
      const response = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/permissions/fake-perm-id`, {
        method: 'DELETE'
      });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /drives/{id}/items/{id}/permissions/{id}', () => {
    it('should get specific permission', async () => {
      // Create a permission first
      const createResponse = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/createLink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'view', scope: 'anonymous' })
      });
      const createData = await createResponse.json();
      const permId = createData.id;

      // Get it
      const response = await fetch(`http://localhost:5097/v1.0/drives/${driveId}/items/${itemId}/permissions/${permId}`);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.id).toBe(permId);
      expect(data.link).toBeDefined();
    });
  });
});
