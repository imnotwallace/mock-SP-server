import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, Database } from '../../src/services/database.js';
import * as fs from 'fs';

describe('Database', () => {
  const dbPath = './test-tmp/test.db';
  let db: Database;

  beforeEach(() => {
    fs.mkdirSync('./test-tmp', { recursive: true });
    db = createDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync('./test-tmp', { recursive: true, force: true });
  });

  it('creates tables on initialization', () => {
    const tables = db.raw.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all() as { name: string }[];

    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('items');
    expect(tableNames).toContain('field_values');
    expect(tableNames).toContain('permissions');
  });

  it('inserts and retrieves items', () => {
    db.upsertItem({
      id: 'test-id',
      path: '/contoso/main/Documents',
      type: 'folder',
      name: 'Documents',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString()
    });

    const item = db.getItemById('test-id');
    expect(item).toBeDefined();
    expect(item?.name).toBe('Documents');
  });

  it('updates existing items', () => {
    const id = 'test-id';
    db.upsertItem({
      id,
      path: '/test',
      type: 'file',
      name: 'old-name',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString()
    });

    db.upsertItem({
      id,
      path: '/test',
      type: 'file',
      name: 'new-name',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString()
    });

    const item = db.getItemById(id);
    expect(item?.name).toBe('new-name');
  });
});
