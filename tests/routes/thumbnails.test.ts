import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createMockServer, MockServer } from '../../src/server.js';
import { MockConfig } from '../../src/config/index.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Thumbnails API', () => {
  let server: MockServer;
  const testRoot = './test-data-thumbnails';
  const dbPath = './test-thumbnails.db';

  beforeAll(async () => {
    // Create test directory structure
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true });
    }
    fs.mkdirSync(testRoot, { recursive: true });

    // Create a site collection and library
    const siteDir = path.join(testRoot, 'TestSite');
    const libraryDir = path.join(siteDir, 'Documents');
    fs.mkdirSync(libraryDir, { recursive: true });

    // Create a simple PNG image (1x1 red pixel)
    const pngData = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d,
      0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
      0x44, 0xae, 0x42, 0x60, 0x82
    ]);
    fs.writeFileSync(path.join(libraryDir, 'test-image.png'), pngData);

    const config: MockConfig = {
      port: 5002,
      root: testRoot,
      auth: { mode: 'none' },
      database: dbPath,
      logging: 'error'
    };

    server = createMockServer(config);
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true });
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  describe('GET /drives/{driveId}/items/{itemId}/thumbnails', () => {
    it('should return thumbnail sets for image files', async () => {
      // Get the library and file IDs
      const sitesRes = await request(server.app).get('/v1.0/sites');
      const siteId = sitesRes.body.value[0].id;

      const drivesRes = await request(server.app).get(`/v1.0/sites/${siteId}/drives`);
      const driveId = drivesRes.body.value[0].id;

      const childrenRes = await request(server.app).get(`/v1.0/drives/${driveId}/root/children`);
      const imageItem = childrenRes.body.value.find((item: any) => item.name === 'test-image.png');

      const response = await request(server.app)
        .get(`/v1.0/drives/${driveId}/items/${imageItem.id}/thumbnails`);

      expect(response.status).toBe(200);
      expect(response.body.value).toBeDefined();
      expect(Array.isArray(response.body.value)).toBe(true);

      if (response.body.value.length > 0) {
        const thumbnailSet = response.body.value[0];
        expect(thumbnailSet.id).toBe('0');
        expect(thumbnailSet.small).toBeDefined();
        expect(thumbnailSet.medium).toBeDefined();
        expect(thumbnailSet.large).toBeDefined();
      }
    });
  });

  describe('GET /drives/{driveId}/items/{itemId}/thumbnails/{thumbId}/{size}', () => {
    it('should return thumbnail content for small size', async () => {
      const sitesRes = await request(server.app).get('/v1.0/sites');
      const siteId = sitesRes.body.value[0].id;

      const drivesRes = await request(server.app).get(`/v1.0/sites/${siteId}/drives`);
      const driveId = drivesRes.body.value[0].id;

      const childrenRes = await request(server.app).get(`/v1.0/drives/${driveId}/root/children`);
      const imageItem = childrenRes.body.value.find((item: any) => item.name === 'test-image.png');

      const response = await request(server.app)
        .get(`/v1.0/drives/${driveId}/items/${imageItem.id}/thumbnails/0/small`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toContain('public');
    });
  });

  describe('$expand=thumbnails', () => {
    it('should include thumbnails when expanding children', async () => {
      const sitesRes = await request(server.app).get('/v1.0/sites');
      const siteId = sitesRes.body.value[0].id;

      const drivesRes = await request(server.app).get(`/v1.0/sites/${siteId}/drives`);
      const driveId = drivesRes.body.value[0].id;

      const response = await request(server.app)
        .get(`/v1.0/drives/${driveId}/root/children?$expand=thumbnails`);

      expect(response.status).toBe(200);
      const imageItem = response.body.value.find((item: any) => item.name === 'test-image.png');

      if (imageItem && imageItem.file) {
        expect(imageItem.thumbnails).toBeDefined();
      }
    });
  });
});
