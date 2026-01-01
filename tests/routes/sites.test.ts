import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../../src/server.js';
import { createDatabase, Database } from '../../src/services/database.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Sites Routes', () => {
  const testDir = './test-tmp-sites';
  let server: MockServer;
  let db: Database;

  beforeAll(async () => {
    fs.mkdirSync(testDir, { recursive: true });

    db = createDatabase(path.join(testDir, 'test.db'));

    // Seed test data
    db.upsertItem({
      id: 'site-collection-1',
      path: '/sites/contoso',
      type: 'siteCollection',
      name: 'Contoso',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z'
    });

    db.upsertItem({
      id: 'site-collection-2',
      path: '/sites/fabrikam',
      type: 'siteCollection',
      name: 'Fabrikam',
      createdAt: '2024-01-02T00:00:00Z',
      modifiedAt: '2024-01-02T00:00:00Z'
    });

    db.upsertItem({
      id: 'subsite-1',
      path: '/sites/contoso/engineering',
      type: 'site',
      parentId: 'site-collection-1',
      name: 'Engineering',
      createdAt: '2024-01-03T00:00:00Z',
      modifiedAt: '2024-01-03T00:00:00Z'
    });

    db.upsertItem({
      id: 'subsite-2',
      path: '/sites/contoso/marketing',
      type: 'site',
      parentId: 'site-collection-1',
      name: 'Marketing',
      createdAt: '2024-01-04T00:00:00Z',
      modifiedAt: '2024-01-04T00:00:00Z'
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

  it('GET /v1.0/sites returns all site collections', async () => {
    const response = await fetch('http://localhost:5098/v1.0/sites');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('@odata.context');
    expect(data['@odata.context']).toBe('https://graph.microsoft.com/v1.0/$metadata#sites');
    expect(data).toHaveProperty('value');
    expect(Array.isArray(data.value)).toBe(true);
    expect(data.value).toHaveLength(2);
    expect(data.value[0]).toHaveProperty('id');
    expect(data.value[0]).toHaveProperty('name');
  });

  it('GET /v1.0/sites supports $select query parameter', async () => {
    const response = await fetch('http://localhost:5098/v1.0/sites?$select=id,name');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.value).toHaveLength(2);

    const site = data.value[0];
    expect(site).toHaveProperty('id');
    expect(site).toHaveProperty('name');
    expect(site).not.toHaveProperty('createdAt');
    expect(site).not.toHaveProperty('path');
  });

  it('GET /v1.0/sites supports $top query parameter', async () => {
    const response = await fetch('http://localhost:5098/v1.0/sites?$top=1');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.value).toHaveLength(1);
  });

  it('GET /v1.0/sites/:siteId returns site by ID', async () => {
    const response = await fetch('http://localhost:5098/v1.0/sites/site-collection-1');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('id', 'site-collection-1');
    expect(data).toHaveProperty('name', 'Contoso');
    expect(data).toHaveProperty('path', '/sites/contoso');
  });

  it('GET /v1.0/sites/:siteId returns 404 for unknown site', async () => {
    const response = await fetch('http://localhost:5098/v1.0/sites/nonexistent');
    expect(response.status).toBe(404);

    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error).toHaveProperty('code', 'itemNotFound');
  });

  it('GET /v1.0/sites/:siteId/sites returns subsites', async () => {
    const response = await fetch('http://localhost:5098/v1.0/sites/site-collection-1/sites');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('@odata.context');
    expect(data).toHaveProperty('value');
    expect(Array.isArray(data.value)).toBe(true);
    expect(data.value).toHaveLength(2);

    const subsites = data.value;
    expect(subsites[0]).toHaveProperty('type', 'site');
    expect(subsites[1]).toHaveProperty('type', 'site');
    expect(subsites.map((s: any) => s.name).sort()).toEqual(['Engineering', 'Marketing']);
  });
});
