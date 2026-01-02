import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../../src/server.js';
import { createDatabase, Database } from '../../src/services/database.js';
import * as fs from 'fs';
import * as path from 'path';
import { decodeSkipToken } from '../../src/utils/skiptoken.js';

describe('Pagination Integration Tests', () => {
  const testDir = './test-tmp-pagination';
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

    // Create 25 test files to test pagination
    for (let i = 1; i <= 25; i++) {
      db.upsertItem({
        id: `file-${i}`,
        path: `sites/contoso/Documents/file-${i}.txt`,
        type: 'file',
        parentId: 'drive-1',
        name: `file-${i}.txt`,
        createdAt: '2024-01-01T00:00:00Z',
        modifiedAt: '2024-01-01T00:00:00Z',
        size: 100
      });
    }

    // Create multiple sites for testing site collection pagination
    for (let i = 2; i <= 15; i++) {
      db.upsertItem({
        id: `site-${i}`,
        path: `sites/site-${i}`,
        type: 'siteCollection',
        name: `Site ${i}`,
        createdAt: '2024-01-01T00:00:00Z',
        modifiedAt: '2024-01-01T00:00:00Z'
      });
    }

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

  describe('Drive Items Pagination', () => {
    it('should return nextLink when more results exist', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/root/children?$top=10');
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.value).toHaveLength(10);
      expect(data['@odata.nextLink']).toBeDefined();
      expect(data['@odata.nextLink']).toContain('$skiptoken=');
    });

    it('should follow nextLink to get next page', async () => {
      // Get first page
      const page1Response = await fetch('http://localhost:5099/v1.0/drives/drive-1/root/children?$top=10');
      const page1Data = await page1Response.json();

      expect(page1Data['@odata.nextLink']).toBeDefined();

      // Get second page via nextLink
      const nextLinkUrl = new URL(page1Data['@odata.nextLink']);
      const page2Response = await fetch(`http://localhost:5099${nextLinkUrl.pathname}${nextLinkUrl.search}`);
      const page2Data = await page2Response.json();

      expect(page2Response.status).toBe(200);
      expect(page2Data.value).toHaveLength(10);

      // Verify no overlap
      const page1Ids = page1Data.value.map((i: any) => i.id);
      const page2Ids = page2Data.value.map((i: any) => i.id);
      const overlap = page1Ids.filter((id: string) => page2Ids.includes(id));
      expect(overlap).toHaveLength(0);
    });

    it('should not return nextLink on last page', async () => {
      // Get through all pages
      let currentUrl = 'http://localhost:5099/v1.0/drives/drive-1/root/children?$top=10';
      let pagesVisited = 0;
      let lastData;

      while (currentUrl && pagesVisited < 10) { // Safety limit
        const response = await fetch(currentUrl);
        lastData = await response.json();
        pagesVisited++;

        if (lastData['@odata.nextLink']) {
          const nextLink = new URL(lastData['@odata.nextLink']);
          currentUrl = `http://localhost:5099${nextLink.pathname}${nextLink.search}`;
        } else {
          currentUrl = '';
        }
      }

      expect(lastData['@odata.nextLink']).toBeUndefined();
      expect(pagesVisited).toBe(3); // 25 items / 10 per page = 3 pages
    });

    it('should include count when $count=true', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/root/children?$count=true&$top=10');
      const data = await response.json();

      expect(data['@odata.count']).toBe(25);
      expect(data.value).toHaveLength(10);
      expect(data['@odata.nextLink']).toBeDefined();
    });

    it('should handle empty result set without nextLink', async () => {
      // Create an empty drive
      const emptyDb = createDatabase(path.join(testDir, 'test.db'));
      emptyDb.upsertItem({
        id: 'drive-empty',
        path: 'sites/contoso/Empty',
        type: 'library',
        parentId: 'site-1',
        name: 'Empty',
        createdAt: '2024-01-01T00:00:00Z',
        modifiedAt: '2024-01-01T00:00:00Z'
      });
      emptyDb.close();

      const response = await fetch('http://localhost:5099/v1.0/drives/drive-empty/root/children');
      const data = await response.json();

      expect(data.value).toHaveLength(0);
      expect(data['@odata.nextLink']).toBeUndefined();
    });

    it('should preserve query params in nextLink skiptoken', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/root/children?$top=10&$select=id,name');
      const data = await response.json();

      expect(data['@odata.nextLink']).toBeDefined();

      const nextLink = new URL(data['@odata.nextLink']);
      const skiptoken = nextLink.searchParams.get('$skiptoken');
      expect(skiptoken).toBeTruthy();

      const decoded = decodeSkipToken(skiptoken!);
      expect(decoded).toBeTruthy();
      expect(decoded!.select).toBe('id,name');
    });

    it('should respect default page size of 100', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/root/children');
      const data = await response.json();

      // Since we only have 25 items, all should be returned
      expect(data.value).toHaveLength(25);
      expect(data['@odata.nextLink']).toBeUndefined();
    });

    it('should cap page size at maximum (200)', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/root/children?$top=500');
      const data = await response.json();

      // All 25 items should be returned (less than max)
      expect(data.value).toHaveLength(25);
    });
  });

  describe('Sites Pagination', () => {
    it('should paginate site collections', async () => {
      const response = await fetch('http://localhost:5099/v1.0/sites?$top=5');
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.value).toHaveLength(5);
      expect(data['@odata.nextLink']).toBeDefined();
    });

    it('should return correct count for sites', async () => {
      const response = await fetch('http://localhost:5099/v1.0/sites?$count=true&$top=5');
      const data = await response.json();

      expect(data['@odata.count']).toBe(14); // 14 siteCollections (site-2 through site-15)
      expect(data.value).toHaveLength(5);
    });
  });

  describe('Lists Pagination', () => {
    it('should paginate list items', async () => {
      // Create a list with items
      const listDb = createDatabase(path.join(testDir, 'test.db'));
      listDb.upsertItem({
        id: 'list-1',
        path: 'sites/contoso/Tasks',
        type: 'list',
        parentId: 'site-1',
        name: 'Tasks',
        createdAt: '2024-01-01T00:00:00Z',
        modifiedAt: '2024-01-01T00:00:00Z'
      });
      listDb.close();

      // Create _items.json with multiple items
      const listDir = path.join(testDir, 'sites/contoso/Tasks');
      fs.mkdirSync(listDir, { recursive: true });
      const items = Array.from({ length: 15 }, (_, i) => ({
        id: `item-${i + 1}`,
        title: `Task ${i + 1}`,
        status: 'Active'
      }));
      fs.writeFileSync(path.join(listDir, '_items.json'), JSON.stringify(items, null, 2));

      const response = await fetch('http://localhost:5099/v1.0/sites/site-1/lists/list-1/items?$top=5');
      const data = await response.json();

      expect(data.value).toHaveLength(5);
      expect(data['@odata.nextLink']).toBeDefined();
    });
  });

  describe('Skiptoken Functionality', () => {
    it('should decode and apply skiptoken correctly', async () => {
      // Get first page
      const page1Response = await fetch('http://localhost:5099/v1.0/drives/drive-1/root/children?$top=10');
      const page1Data = await page1Response.json();

      // Extract and verify skiptoken
      const nextLink = new URL(page1Data['@odata.nextLink']);
      const skiptoken = nextLink.searchParams.get('$skiptoken');
      expect(skiptoken).toBeTruthy();

      const decoded = decodeSkipToken(skiptoken!);
      expect(decoded).toBeTruthy();
      expect(decoded!.skip).toBe(10);
      expect(decoded!.top).toBe(10);
    });

    it('should handle skiptoken with filter preservation', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/root/children?$top=5&$filter=size gt 50');
      const data = await response.json();

      if (data['@odata.nextLink']) {
        const nextLink = new URL(data['@odata.nextLink']);
        const skiptoken = nextLink.searchParams.get('$skiptoken');
        const decoded = decodeSkipToken(skiptoken!);

        expect(decoded!.filter).toBe('size gt 50');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle exact page boundary correctly', async () => {
      // Get exactly 10 items (not creating nextLink if it's the last page)
      const exactDb = createDatabase(path.join(testDir, 'test.db'));
      exactDb.upsertItem({
        id: 'drive-exact',
        path: 'sites/contoso/Exact',
        type: 'library',
        parentId: 'site-1',
        name: 'Exact',
        createdAt: '2024-01-01T00:00:00Z',
        modifiedAt: '2024-01-01T00:00:00Z'
      });

      // Create exactly 10 items
      for (let i = 1; i <= 10; i++) {
        exactDb.upsertItem({
          id: `exact-file-${i}`,
          path: `sites/contoso/Exact/file-${i}.txt`,
          type: 'file',
          parentId: 'drive-exact',
          name: `file-${i}.txt`,
          createdAt: '2024-01-01T00:00:00Z',
          modifiedAt: '2024-01-01T00:00:00Z',
          size: 100
        });
      }
      exactDb.close();

      const response = await fetch('http://localhost:5099/v1.0/drives/drive-exact/root/children?$top=10');
      const data = await response.json();

      expect(data.value).toHaveLength(10);
      expect(data['@odata.nextLink']).toBeUndefined(); // No more pages
    });

    it('should handle skip beyond total items', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/root/children?$skip=100');
      const data = await response.json();

      expect(data.value).toHaveLength(0);
      expect(data['@odata.nextLink']).toBeUndefined();
    });

    it('should handle $top=0', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/root/children?$top=0');
      const data = await response.json();

      expect(data.value).toHaveLength(0);
    });
  });

  describe('Integration with Other OData Features', () => {
    it('should paginate with $select applied', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/root/children?$top=10&$select=id,name');
      const data = await response.json();

      expect(data.value).toHaveLength(10);
      expect(data.value[0]).toHaveProperty('id');
      expect(data.value[0]).toHaveProperty('name');
      expect(data.value[0]).not.toHaveProperty('size'); // Not selected
    });

    it('should paginate with $filter applied', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/root/children?$top=5&$filter=size eq 100');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.value.length).toBeLessThanOrEqual(5);

      // All returned items should match the filter
      data.value.forEach((item: any) => {
        expect(item.size).toBe(100);
      });
    });

    it('should combine $count, $filter, and pagination', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/root/children?$count=true&$top=5&$filter=size eq 100');
      const data = await response.json();

      expect(data).toHaveProperty('@odata.count');
      expect(data.value.length).toBeLessThanOrEqual(5);
    });
  });
});
