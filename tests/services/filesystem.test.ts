import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FilesystemService } from '../../src/services/filesystem.js';
import { createDatabase } from '../../src/services/database.js';
import * as fs from 'fs';
import * as path from 'path';

describe('FilesystemService', () => {
  const testDir = './test-tmp';
  const dbPath = path.join(testDir, 'test.db');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(path.join(testDir, 'data/contoso/main/Documents'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'data/contoso/main/Documents/test.txt'), 'hello');
    fs.writeFileSync(
      path.join(testDir, 'data/contoso/_site.json'),
      JSON.stringify({ displayName: 'Contoso', description: 'Test site collection' })
    );
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('scans directory and discovers site collections', () => {
    const db = createDatabase(dbPath);
    const fsService = new FilesystemService(path.join(testDir, 'data'), db);
    fsService.scan();
    const siteCollections = db.getItemsByType('siteCollection');
    expect(siteCollections.length).toBe(1);
    expect(siteCollections[0].name).toBe('contoso');
    db.close();
  });

  it('discovers sites within site collections', () => {
    const db = createDatabase(dbPath);
    const fsService = new FilesystemService(path.join(testDir, 'data'), db);
    fsService.scan();
    const sites = db.getItemsByType('site');
    expect(sites.length).toBe(1);
    expect(sites[0].name).toBe('main');
    db.close();
  });

  it('discovers libraries within sites', () => {
    const db = createDatabase(dbPath);
    const fsService = new FilesystemService(path.join(testDir, 'data'), db);
    fsService.scan();
    const libraries = db.getItemsByType('library');
    expect(libraries.length).toBe(1);
    expect(libraries[0].name).toBe('Documents');
    db.close();
  });

  it('discovers files within libraries', () => {
    const db = createDatabase(dbPath);
    const fsService = new FilesystemService(path.join(testDir, 'data'), db);
    fsService.scan();
    const files = db.getItemsByType('file');
    expect(files.length).toBe(1);
    expect(files[0].name).toBe('test.txt');
    db.close();
  });
});
