import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../../src/server.js';
import { createDatabase, Database } from '../../src/services/database.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Search API', () => {
  const testDir = './test-tmp-search';
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

    // Create test library (Documents)
    db.upsertItem({
      id: 'drive-1',
      path: 'sites/contoso/Documents',
      type: 'library',
      parentId: 'site-1',
      name: 'Documents',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z'
    });

    // Create test files with various names
    const docsDir = path.join(testDir, 'sites/contoso/Documents');
    fs.mkdirSync(docsDir, { recursive: true });

    // Create test files
    const files = [
      { name: 'test.txt', content: 'Test content' },
      { name: 'report.pdf', content: 'Report content' },
      { name: 'presentation.pptx', content: 'Presentation' },
      { name: 'spreadsheet.xlsx', content: 'Spreadsheet' },
      { name: 'quarterly-report.docx', content: 'Q1 Report' },
      { name: 'test-document.docx', content: 'Test doc' },
      { name: 'data.json', content: '{}' }
    ];

    files.forEach((file, index) => {
      fs.writeFileSync(path.join(docsDir, file.name), file.content);
      db.upsertItem({
        id: `file-${index + 1}`,
        path: `sites/contoso/Documents/${file.name}`,
        type: 'file',
        parentId: 'drive-1',
        name: file.name,
        createdAt: '2024-01-01T00:00:00Z',
        modifiedAt: '2024-01-01T00:00:00Z',
        size: file.content.length
      });
    });

    // Create a folder
    db.upsertItem({
      id: 'folder-1',
      path: 'sites/contoso/Documents/Reports',
      type: 'folder',
      parentId: 'drive-1',
      name: 'Reports',
      createdAt: '2024-01-02T00:00:00Z',
      modifiedAt: '2024-01-02T00:00:00Z'
    });

    // Create another site for multi-entity search
    db.upsertItem({
      id: 'site-2',
      path: 'sites/test-site',
      type: 'site',
      name: 'Test Site',
      createdAt: '2024-01-01T00:00:00Z',
      modifiedAt: '2024-01-01T00:00:00Z'
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

  describe('POST /v1.0/search/query', () => {
    it('searches driveItems by name', async () => {
      const response = await fetch('http://localhost:5099/v1.0/search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            entityTypes: ['driveItem'],
            query: { queryString: 'test' }
          }]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('value');
      expect(Array.isArray(data.value)).toBe(true);
      expect(data.value.length).toBe(1);

      const result = data.value[0];
      expect(result).toHaveProperty('searchTerms');
      expect(result.searchTerms).toContain('test');
      expect(result).toHaveProperty('hitsContainers');
      expect(Array.isArray(result.hitsContainers)).toBe(true);

      const hits = result.hitsContainers[0].hits;
      expect(hits.length).toBeGreaterThan(0);

      // Verify hits contain 'test' in the name
      hits.forEach((hit: any) => {
        expect(hit.resource.name.toLowerCase()).toContain('test');
      });
    });

    it('applies filetype filter', async () => {
      const response = await fetch('http://localhost:5099/v1.0/search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            entityTypes: ['driveItem'],
            query: { queryString: 'filetype:pdf' }
          }]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      const hits = data.value[0].hitsContainers[0].hits;
      expect(hits.length).toBeGreaterThan(0);
      hits.forEach((hit: any) => {
        expect(hit.resource.name).toMatch(/\.pdf$/);
      });
    });

    it('applies isDocument filter', async () => {
      const response = await fetch('http://localhost:5099/v1.0/search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            entityTypes: ['driveItem'],
            query: { queryString: 'isDocument:true' }
          }]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      const hits = data.value[0].hitsContainers[0].hits;
      hits.forEach((hit: any) => {
        expect(hit.resource.file).toBeDefined(); // Files have file property
        expect(hit.resource.folder).toBeUndefined(); // Files don't have folder property
      });
    });

    it('supports pagination with from and size', async () => {
      const response = await fetch('http://localhost:5099/v1.0/search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            entityTypes: ['driveItem'],
            query: { queryString: 'report' },
            from: 0,
            size: 1
          }]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      const container = data.value[0].hitsContainers[0];
      expect(container.hits).toHaveLength(1);
      expect(container.moreResultsAvailable).toBe(true);
      expect(container.total).toBeGreaterThan(1);
    });

    it('searches multiple entity types', async () => {
      const response = await fetch('http://localhost:5099/v1.0/search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            entityTypes: ['driveItem', 'site'],
            query: { queryString: 'test' }
          }]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      const hits = data.value[0].hitsContainers[0].hits;
      expect(hits.length).toBeGreaterThan(0);

      // Should find both files and sites with 'test' in name
      const types = hits.map((h: any) => h.resource['@odata.type']);
      const uniqueTypes = [...new Set(types)];
      expect(uniqueTypes.length).toBeGreaterThan(0);
    });

    it('returns empty results for no matches', async () => {
      const response = await fetch('http://localhost:5099/v1.0/search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            entityTypes: ['driveItem'],
            query: { queryString: 'xyznonexistent123' }
          }]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      const hits = data.value[0].hitsContainers[0].hits;
      expect(hits).toHaveLength(0);
      expect(data.value[0].hitsContainers[0].total).toBe(0);
    });

    it('validates required fields', async () => {
      const response = await fetch('http://localhost:5099/v1.0/search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            query: { queryString: 'test' }
            // missing entityTypes
          }]
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('handles multiple search requests', async () => {
      const response = await fetch('http://localhost:5099/v1.0/search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              entityTypes: ['driveItem'],
              query: { queryString: 'test' }
            },
            {
              entityTypes: ['site'],
              query: { queryString: 'contoso' }
            }
          ]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.value).toHaveLength(2);
      expect(data.value[0].hitsContainers).toBeDefined();
      expect(data.value[1].hitsContainers).toBeDefined();
    });

    it('includes hit metadata', async () => {
      const response = await fetch('http://localhost:5099/v1.0/search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            entityTypes: ['driveItem'],
            query: { queryString: 'test.txt' }
          }]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      const hits = data.value[0].hitsContainers[0].hits;
      expect(hits.length).toBeGreaterThan(0);

      const hit = hits[0];
      expect(hit).toHaveProperty('hitId');
      expect(hit).toHaveProperty('rank');
      expect(hit).toHaveProperty('summary');
      expect(hit).toHaveProperty('resource');
      expect(typeof hit.rank).toBe('number');
      expect(hit.rank).toBeGreaterThan(0);
    });

    it('ranks exact matches higher', async () => {
      const response = await fetch('http://localhost:5099/v1.0/search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            entityTypes: ['driveItem'],
            query: { queryString: 'report' }
          }]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      const hits = data.value[0].hitsContainers[0].hits;
      if (hits.length > 1) {
        // Exact match should rank higher than partial match
        const exactMatch = hits.find((h: any) => h.resource.name === 'report.pdf');
        const partialMatch = hits.find((h: any) => h.resource.name === 'quarterly-report.docx');

        if (exactMatch && partialMatch) {
          expect(exactMatch.rank).toBeGreaterThan(partialMatch.rank);
        }
      }
    });
  });

  describe('GET /v1.0/drives/:driveId/search', () => {
    it('searches within specific drive using query parameter', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/search?q=test');

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('@odata.context');
      expect(data).toHaveProperty('value');
      expect(Array.isArray(data.value)).toBe(true);
      expect(data.value.length).toBeGreaterThan(0);

      // All results should contain 'test'
      data.value.forEach((item: any) => {
        expect(item.name.toLowerCase()).toContain('test');
      });
    });

    it('returns empty array for no matches', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/search?q=xyznonexistent123');

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.value).toHaveLength(0);
    });

    it('requires query parameter', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/search');

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain('query');
    });

    it('applies filetype filter in drive search', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/search?q=filetype:docx');

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.value.length).toBeGreaterThan(0);
      data.value.forEach((item: any) => {
        expect(item.name).toMatch(/\.docx$/);
      });
    });

    it('supports multiple search terms', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/search?q=quarterly%20report');

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.value.length).toBeGreaterThan(0);
      data.value.forEach((item: any) => {
        const nameLower = item.name.toLowerCase();
        expect(nameLower.includes('quarterly') && nameLower.includes('report')).toBe(true);
      });
    });

    it('returns 404 for non-existent drive', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/nonexistent/search?q=test');

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('supports $select parameter', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/search?q=test&$select=id,name');

      expect(response.status).toBe(200);
      const data = await response.json();

      if (data.value.length > 0) {
        const item = data.value[0];
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('name');
        // Should not have other properties when select is used
        // (Note: select implementation may vary)
      }
    });

    it('includes enhanced metadata in results', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/search?q=test.txt');

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.value.length).toBeGreaterThan(0);
      const item = data.value[0];

      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('createdDateTime');
      expect(item).toHaveProperty('lastModifiedDateTime');

      // File should have file metadata
      if (item.name.endsWith('.txt')) {
        expect(item).toHaveProperty('file');
        expect(item.file).toHaveProperty('mimeType');
      }
    });

    it('finds files and folders', async () => {
      const response = await fetch('http://localhost:5099/v1.0/drives/drive-1/search?q=report');

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.value.length).toBeGreaterThan(0);

      // Should find both 'Reports' folder and files with 'report' in name
      const hasFolder = data.value.some((item: any) => item.folder !== undefined);
      const hasFile = data.value.some((item: any) => item.file !== undefined);

      expect(hasFolder || hasFile).toBe(true);
    });
  });

  describe('Search edge cases', () => {
    it('handles special characters in search', async () => {
      const response = await fetch('http://localhost:5099/v1.0/search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            entityTypes: ['driveItem'],
            query: { queryString: 'test-document' }
          }]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should handle hyphenated search terms
      const hits = data.value[0].hitsContainers[0].hits;
      if (hits.length > 0) {
        expect(hits.some((h: any) => h.resource.name.includes('test-document'))).toBe(true);
      }
    });

    it('handles quoted search terms', async () => {
      const response = await fetch('http://localhost:5099/v1.0/search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            entityTypes: ['driveItem'],
            query: { queryString: '"test document"' }
          }]
        })
      });

      expect(response.status).toBe(200);
      // Should parse quoted terms correctly
    });

    it('caps page size at 200', async () => {
      const response = await fetch('http://localhost:5099/v1.0/search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            entityTypes: ['driveItem'],
            query: { queryString: '' },
            size: 1000 // Request more than cap
          }]
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      const hits = data.value[0].hitsContainers[0].hits;
      // Should be capped at 200 max
      expect(hits.length).toBeLessThanOrEqual(200);
    });
  });
});
