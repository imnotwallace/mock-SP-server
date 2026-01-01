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

  it('loads file metadata from _files.json', () => {
    // Create _files.json with metadata
    fs.writeFileSync(
      path.join(testDir, 'data/contoso/main/Documents/_files.json'),
      JSON.stringify({
        'test.txt': {
          createdBy: { displayName: 'John Doe', email: 'john@contoso.com' },
          lastModifiedBy: { displayName: 'Jane Smith', email: 'jane@contoso.com' },
          fields: {
            Department: 'Marketing',
            Status: 'Final'
          }
        }
      })
    );

    const db = createDatabase(dbPath);
    const fsService = new FilesystemService(path.join(testDir, 'data'), db);
    fsService.scan();

    // Get the file
    const files = db.getItemsByType('file');
    expect(files.length).toBe(1);

    // Check field values were stored
    const fieldValues = db.getFieldValues(files[0].id);
    const fieldMap = Object.fromEntries(fieldValues.map(f => [f.fieldName, f.fieldValue]));

    expect(fieldMap['createdBy.displayName']).toBe('John Doe');
    expect(fieldMap['createdBy.email']).toBe('john@contoso.com');
    expect(fieldMap['lastModifiedBy.displayName']).toBe('Jane Smith');
    expect(fieldMap['fields.Department']).toBe('Marketing');
    expect(fieldMap['fields.Status']).toBe('Final');

    db.close();
  });

  it('loads library columns from _library.json', () => {
    // Create _library.json with columns
    fs.writeFileSync(
      path.join(testDir, 'data/contoso/main/Documents/_library.json'),
      JSON.stringify({
        displayName: 'Documents',
        columns: [
          { name: 'Department', type: 'text' },
          { name: 'Status', type: 'choice', choices: ['Draft', 'Review', 'Final'] }
        ]
      })
    );

    const db = createDatabase(dbPath);
    const fsService = new FilesystemService(path.join(testDir, 'data'), db);
    fsService.scan();

    const libraries = db.getItemsByType('library');
    expect(libraries.length).toBe(1);

    const fieldValues = db.getFieldValues(libraries[0].id);
    const fieldMap = Object.fromEntries(fieldValues.map(f => [f.fieldName, f.fieldValue]));

    expect(fieldMap['columns']).toBeDefined();
    const columns = JSON.parse(fieldMap['columns']);
    expect(columns).toHaveLength(2);
    expect(columns[0].name).toBe('Department');

    db.close();
  });
});
