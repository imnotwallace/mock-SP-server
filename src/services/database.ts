import BetterSqlite3 from 'better-sqlite3';

export interface ItemRecord {
  id: string;
  path: string;
  type: 'file' | 'folder' | 'listItem' | 'site' | 'siteCollection' | 'list' | 'library';
  parentId?: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  etag?: string;
  size?: number;
}

export interface FieldValue {
  itemId: string;
  fieldName: string;
  fieldValue: string;
}

export interface Database {
  raw: BetterSqlite3.Database;
  upsertItem(item: ItemRecord): void;
  getItemById(id: string): ItemRecord | undefined;
  getItemByPath(path: string): ItemRecord | undefined;
  getItemsByParent(parentId: string): ItemRecord[];
  getItemsByType(type: ItemRecord['type']): ItemRecord[];
  deleteItem(id: string): void;
  setFieldValue(itemId: string, fieldName: string, fieldValue: string): void;
  getFieldValues(itemId: string): FieldValue[];
  close(): void;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    created_at TEXT,
    modified_at TEXT,
    etag TEXT,
    size INTEGER
  );

  CREATE TABLE IF NOT EXISTS field_values (
    item_id TEXT,
    field_name TEXT,
    field_value TEXT,
    PRIMARY KEY (item_id, field_name)
  );

  CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    item_id TEXT,
    principal TEXT,
    role TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_id);
  CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
  CREATE INDEX IF NOT EXISTS idx_items_path ON items(path);
`;

export function createDatabase(dbPath: string): Database {
  const db = new BetterSqlite3(dbPath);
  db.exec(SCHEMA);

  const upsertStmt = db.prepare(`
    INSERT INTO items (id, path, type, parent_id, name, created_at, modified_at, etag, size)
    VALUES (@id, @path, @type, @parentId, @name, @createdAt, @modifiedAt, @etag, @size)
    ON CONFLICT(id) DO UPDATE SET
      path = @path,
      type = @type,
      parent_id = @parentId,
      name = @name,
      modified_at = @modifiedAt,
      etag = @etag,
      size = @size
  `);

  const getByIdStmt = db.prepare('SELECT * FROM items WHERE id = ?');
  const getByPathStmt = db.prepare('SELECT * FROM items WHERE path = ?');
  const getByParentStmt = db.prepare('SELECT * FROM items WHERE parent_id = ?');
  const getByTypeStmt = db.prepare('SELECT * FROM items WHERE type = ?');
  const deleteStmt = db.prepare('DELETE FROM items WHERE id = ?');

  const setFieldStmt = db.prepare(`
    INSERT INTO field_values (item_id, field_name, field_value)
    VALUES (?, ?, ?)
    ON CONFLICT(item_id, field_name) DO UPDATE SET field_value = excluded.field_value
  `);
  const getFieldsStmt = db.prepare('SELECT * FROM field_values WHERE item_id = ?');

  const mapRow = (row: any): ItemRecord | undefined => {
    if (!row) return undefined;
    return {
      id: row.id,
      path: row.path,
      type: row.type,
      parentId: row.parent_id,
      name: row.name,
      createdAt: row.created_at,
      modifiedAt: row.modified_at,
      etag: row.etag,
      size: row.size
    };
  };

  return {
    raw: db,

    upsertItem(item: ItemRecord): void {
      upsertStmt.run({
        id: item.id,
        path: item.path,
        type: item.type,
        parentId: item.parentId ?? null,
        name: item.name,
        createdAt: item.createdAt,
        modifiedAt: item.modifiedAt,
        etag: item.etag ?? null,
        size: item.size ?? null
      });
    },

    getItemById(id: string): ItemRecord | undefined {
      return mapRow(getByIdStmt.get(id));
    },

    getItemByPath(path: string): ItemRecord | undefined {
      return mapRow(getByPathStmt.get(path));
    },

    getItemsByParent(parentId: string): ItemRecord[] {
      return (getByParentStmt.all(parentId) as any[]).map(mapRow).filter(Boolean) as ItemRecord[];
    },

    getItemsByType(type: ItemRecord['type']): ItemRecord[] {
      return (getByTypeStmt.all(type) as any[]).map(mapRow).filter(Boolean) as ItemRecord[];
    },

    deleteItem(id: string): void {
      deleteStmt.run(id);
    },

    setFieldValue(itemId: string, fieldName: string, fieldValue: string): void {
      setFieldStmt.run(itemId, fieldName, fieldValue);
    },

    getFieldValues(itemId: string): FieldValue[] {
      return getFieldsStmt.all(itemId) as FieldValue[];
    },

    close(): void {
      db.close();
    }
  };
}
