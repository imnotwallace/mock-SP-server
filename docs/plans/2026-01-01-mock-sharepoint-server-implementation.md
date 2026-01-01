# Mock SharePoint Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local Node.js/TypeScript server that mimics Microsoft Graph SharePoint endpoints for testing and development.

**Architecture:** Express.js server with SQLite for metadata, filesystem for actual files. Routes mirror Graph API structure. Config via JSON file + CLI flags + programmatic API.

**Tech Stack:** Node.js 18+, TypeScript, Express.js, better-sqlite3, commander (CLI), vitest (testing)

---

## Task 1: Project Initialization

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`

**Step 1: Initialize npm project**

Run:
```bash
cd F:/mock-SP-server && npm init -y
```

**Step 2: Install dependencies**

Run:
```bash
npm install express better-sqlite3 commander
npm install -D typescript @types/node @types/express @types/better-sqlite3 vitest tsx
```

**Step 3: Create tsconfig.json**

Create file `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Update package.json scripts and config**

Add to `package.json`:
```json
{
  "name": "mock-sp-server",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "mock-sp-server": "./dist/bin/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/bin/cli.ts",
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

**Step 5: Create placeholder entry point**

Create file `src/index.ts`:
```typescript
export const VERSION = '1.0.0';
```

**Step 6: Verify build works**

Run:
```bash
npm run build
```
Expected: Compiles without errors, creates `dist/index.js`

**Step 7: Commit**

```bash
git add -A && git commit -m "chore: initialize project with TypeScript and dependencies"
```

---

## Task 2: Configuration Types and Loading

**Files:**
- Create: `src/config/types.ts`
- Create: `src/config/loader.ts`
- Create: `src/config/index.ts`
- Create: `tests/config/loader.test.ts`

**Step 1: Write failing test for config loading**

Create file `tests/config/loader.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, DEFAULT_CONFIG } from '../../src/config/index.js';
import * as fs from 'fs';
import * as path from 'path';

describe('loadConfig', () => {
  const testDir = './test-tmp';

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('returns default config when no file exists', () => {
    const config = loadConfig({ root: testDir });
    expect(config.port).toBe(5001);
    expect(config.auth.mode).toBe('none');
  });

  it('loads config from file', () => {
    const configPath = path.join(testDir, 'mock-sp.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ port: 8080 }));

    const config = loadConfig({ configFile: configPath });
    expect(config.port).toBe(8080);
  });

  it('CLI options override file config', () => {
    const configPath = path.join(testDir, 'mock-sp.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ port: 8080 }));

    const config = loadConfig({ configFile: configPath, port: 9000 });
    expect(config.port).toBe(9000);
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- tests/config/loader.test.ts
```
Expected: FAIL - module not found

**Step 3: Create config types**

Create file `src/config/types.ts`:
```typescript
export interface AuthConfig {
  mode: 'none' | 'static' | 'oauth';
  tokens?: string[];
}

export interface Config {
  port: number;
  root: string;
  auth: AuthConfig;
  database: string;
  logging: 'debug' | 'info' | 'warn' | 'error';
}

export interface CliOptions {
  port?: number;
  root?: string;
  auth?: 'none' | 'static' | 'oauth';
  database?: string;
  logging?: 'debug' | 'info' | 'warn' | 'error';
  configFile?: string;
}

export const DEFAULT_CONFIG: Config = {
  port: 5001,
  root: './data',
  auth: { mode: 'none' },
  database: './mock-sp.db',
  logging: 'info'
};
```

**Step 4: Create config loader**

Create file `src/config/loader.ts`:
```typescript
import * as fs from 'fs';
import * as path from 'path';
import { Config, CliOptions, DEFAULT_CONFIG } from './types.js';

export function loadConfig(options: CliOptions = {}): Config {
  let fileConfig: Partial<Config> = {};

  // Try to load config file
  const configPath = options.configFile || './mock-sp.config.json';
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(content);
  }

  // Merge: defaults < file < CLI options
  const config: Config = {
    port: options.port ?? fileConfig.port ?? DEFAULT_CONFIG.port,
    root: options.root ?? fileConfig.root ?? DEFAULT_CONFIG.root,
    auth: {
      mode: options.auth ?? fileConfig.auth?.mode ?? DEFAULT_CONFIG.auth.mode,
      tokens: fileConfig.auth?.tokens ?? DEFAULT_CONFIG.auth.tokens
    },
    database: options.database ?? fileConfig.database ?? DEFAULT_CONFIG.database,
    logging: options.logging ?? fileConfig.logging ?? DEFAULT_CONFIG.logging
  };

  return config;
}
```

**Step 5: Create config index**

Create file `src/config/index.ts`:
```typescript
export { Config, CliOptions, AuthConfig, DEFAULT_CONFIG } from './types.js';
export { loadConfig } from './loader.js';
```

**Step 6: Run tests to verify they pass**

Run:
```bash
npm run test:run -- tests/config/loader.test.ts
```
Expected: PASS

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: add configuration loading with defaults and overrides"
```

---

## Task 3: ID Generation Utility

**Files:**
- Create: `src/utils/id.ts`
- Create: `src/utils/index.ts`
- Create: `tests/utils/id.test.ts`

**Step 1: Write failing test for ID generation**

Create file `tests/utils/id.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { generateId, pathToId } from '../../src/utils/id.js';

describe('generateId', () => {
  it('generates consistent ID for same input', () => {
    const id1 = generateId('sites/contoso');
    const id2 = generateId('sites/contoso');
    expect(id1).toBe(id2);
  });

  it('generates different IDs for different inputs', () => {
    const id1 = generateId('sites/contoso');
    const id2 = generateId('sites/fabrikam');
    expect(id1).not.toBe(id2);
  });

  it('generates valid GUID format', () => {
    const id = generateId('sites/contoso');
    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(id).toMatch(guidRegex);
  });
});

describe('pathToId', () => {
  it('normalizes path separators', () => {
    const id1 = pathToId('contoso/main/Documents');
    const id2 = pathToId('contoso\\main\\Documents');
    expect(id1).toBe(id2);
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- tests/utils/id.test.ts
```
Expected: FAIL - module not found

**Step 3: Implement ID generation**

Create file `src/utils/id.ts`:
```typescript
import { createHash } from 'crypto';

export function generateId(input: string): string {
  const hash = createHash('sha256').update(input).digest('hex');
  // Format as GUID: 8-4-4-4-12
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32)
  ].join('-');
}

export function pathToId(fsPath: string): string {
  // Normalize path separators and generate ID
  const normalized = fsPath.replace(/\\/g, '/').toLowerCase();
  return generateId(normalized);
}
```

**Step 4: Create utils index**

Create file `src/utils/index.ts`:
```typescript
export { generateId, pathToId } from './id.js';
```

**Step 5: Run tests to verify they pass**

Run:
```bash
npm run test:run -- tests/utils/id.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add deterministic GUID generation from paths"
```

---

## Task 4: Logger Utility

**Files:**
- Create: `src/utils/logger.ts`
- Modify: `src/utils/index.ts`
- Create: `tests/utils/logger.test.ts`

**Step 1: Write failing test for logger**

Create file `tests/utils/logger.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { createLogger, LogLevel } from '../../src/utils/logger.js';

describe('createLogger', () => {
  it('logs info messages at info level', () => {
    const output: string[] = [];
    const logger = createLogger('info', (msg) => output.push(msg));

    logger.info('test message');

    expect(output.length).toBe(1);
    expect(output[0]).toContain('INFO');
    expect(output[0]).toContain('test message');
  });

  it('does not log debug at info level', () => {
    const output: string[] = [];
    const logger = createLogger('info', (msg) => output.push(msg));

    logger.debug('debug message');

    expect(output.length).toBe(0);
  });

  it('logs debug at debug level', () => {
    const output: string[] = [];
    const logger = createLogger('debug', (msg) => output.push(msg));

    logger.debug('debug message');

    expect(output.length).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- tests/utils/logger.test.ts
```
Expected: FAIL - module not found

**Step 3: Implement logger**

Create file `src/utils/logger.ts`:
```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

export interface Logger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export function createLogger(
  level: LogLevel,
  output: (message: string) => void = console.log
): Logger {
  const shouldLog = (msgLevel: LogLevel): boolean => {
    return LEVEL_PRIORITY[msgLevel] >= LEVEL_PRIORITY[level];
  };

  const formatMessage = (msgLevel: LogLevel, message: string): string => {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const levelStr = msgLevel.toUpperCase().padEnd(5);
    return `[${timestamp}] ${levelStr} ${message}`;
  };

  return {
    debug: (message: string) => {
      if (shouldLog('debug')) output(formatMessage('debug', message));
    },
    info: (message: string) => {
      if (shouldLog('info')) output(formatMessage('info', message));
    },
    warn: (message: string) => {
      if (shouldLog('warn')) output(formatMessage('warn', message));
    },
    error: (message: string) => {
      if (shouldLog('error')) output(formatMessage('error', message));
    }
  };
}
```

**Step 4: Update utils index**

Add to `src/utils/index.ts`:
```typescript
export { generateId, pathToId } from './id.js';
export { createLogger, Logger, LogLevel } from './logger.js';
```

**Step 5: Run tests to verify they pass**

Run:
```bash
npm run test:run -- tests/utils/logger.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add configurable logger utility"
```

---

## Task 5: SQLite Database Service

**Files:**
- Create: `src/services/database.ts`
- Create: `src/services/index.ts`
- Create: `tests/services/database.test.ts`

**Step 1: Write failing test for database**

Create file `tests/services/database.test.ts`:
```typescript
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
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- tests/services/database.test.ts
```
Expected: FAIL - module not found

**Step 3: Implement database service**

Create file `src/services/database.ts`:
```typescript
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
```

**Step 4: Create services index**

Create file `src/services/index.ts`:
```typescript
export { createDatabase, Database, ItemRecord, FieldValue } from './database.js';
```

**Step 5: Run tests to verify they pass**

Run:
```bash
npm run test:run -- tests/services/database.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add SQLite database service with item storage"
```

---

## Task 6: Filesystem Scanner Service

**Files:**
- Create: `src/services/filesystem.ts`
- Modify: `src/services/index.ts`
- Create: `tests/services/filesystem.test.ts`

**Step 1: Write failing test for filesystem scanner**

Create file `tests/services/filesystem.test.ts`:
```typescript
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
    // Create mock SharePoint structure
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
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- tests/services/filesystem.test.ts
```
Expected: FAIL - module not found

**Step 3: Implement filesystem service**

Create file `src/services/filesystem.ts`:
```typescript
import * as fs from 'fs';
import * as path from 'path';
import { Database, ItemRecord } from './database.js';
import { pathToId } from '../utils/id.js';

interface SiteMetadata {
  displayName?: string;
  description?: string;
}

interface LibraryMetadata {
  displayName?: string;
  description?: string;
  columns?: Array<{ name: string; type: string }>;
}

export class FilesystemService {
  constructor(
    private root: string,
    private db: Database
  ) {}

  scan(): { siteCollections: number; sites: number; libraries: number; files: number } {
    const stats = { siteCollections: 0, sites: 0, libraries: 0, files: 0 };

    if (!fs.existsSync(this.root)) {
      return stats;
    }

    // Level 0: Root contains site collections
    const siteCollectionDirs = this.getDirectories(this.root);

    for (const scDir of siteCollectionDirs) {
      const scPath = path.join(this.root, scDir);
      const scId = pathToId(scDir);
      const scMeta = this.loadMetadata<SiteMetadata>(scPath);

      this.db.upsertItem({
        id: scId,
        path: scDir,
        type: 'siteCollection',
        name: scDir,
        createdAt: this.getCreatedTime(scPath),
        modifiedAt: this.getModifiedTime(scPath)
      });

      if (scMeta?.displayName) {
        this.db.setFieldValue(scId, 'displayName', scMeta.displayName);
      }
      if (scMeta?.description) {
        this.db.setFieldValue(scId, 'description', scMeta.description);
      }

      stats.siteCollections++;

      // Level 1: Sites within site collection
      const siteDirs = this.getDirectories(scPath);

      for (const siteDir of siteDirs) {
        const sitePath = path.join(scPath, siteDir);
        const siteRelPath = `${scDir}/${siteDir}`;
        const siteId = pathToId(siteRelPath);
        const siteMeta = this.loadMetadata<SiteMetadata>(sitePath);

        this.db.upsertItem({
          id: siteId,
          path: siteRelPath,
          type: 'site',
          parentId: scId,
          name: siteDir,
          createdAt: this.getCreatedTime(sitePath),
          modifiedAt: this.getModifiedTime(sitePath)
        });

        if (siteMeta?.displayName) {
          this.db.setFieldValue(siteId, 'displayName', siteMeta.displayName);
        }

        stats.sites++;

        // Level 2: Libraries within site
        const libraryDirs = this.getDirectories(sitePath);

        for (const libDir of libraryDirs) {
          const libPath = path.join(sitePath, libDir);
          const libRelPath = `${siteRelPath}/${libDir}`;
          const libId = pathToId(libRelPath);
          const libMeta = this.loadMetadata<LibraryMetadata>(libPath, '_library.json');

          this.db.upsertItem({
            id: libId,
            path: libRelPath,
            type: 'library',
            parentId: siteId,
            name: libDir,
            createdAt: this.getCreatedTime(libPath),
            modifiedAt: this.getModifiedTime(libPath)
          });

          if (libMeta?.displayName) {
            this.db.setFieldValue(libId, 'displayName', libMeta.displayName);
          }

          stats.libraries++;

          // Level 3+: Files and folders within library
          const fileStats = this.scanLibraryContents(libPath, libRelPath, libId);
          stats.files += fileStats.files;
        }
      }
    }

    return stats;
  }

  private scanLibraryContents(
    dirPath: string,
    relPath: string,
    parentId: string
  ): { files: number; folders: number } {
    const stats = { files: 0, folders: 0 };

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip metadata files
      if (entry.name.startsWith('_')) continue;

      const entryPath = path.join(dirPath, entry.name);
      const entryRelPath = `${relPath}/${entry.name}`;
      const entryId = pathToId(entryRelPath);

      if (entry.isDirectory()) {
        this.db.upsertItem({
          id: entryId,
          path: entryRelPath,
          type: 'folder',
          parentId,
          name: entry.name,
          createdAt: this.getCreatedTime(entryPath),
          modifiedAt: this.getModifiedTime(entryPath)
        });
        stats.folders++;

        // Recurse into subdirectory
        const subStats = this.scanLibraryContents(entryPath, entryRelPath, entryId);
        stats.files += subStats.files;
        stats.folders += subStats.folders;
      } else {
        const fileStat = fs.statSync(entryPath);
        this.db.upsertItem({
          id: entryId,
          path: entryRelPath,
          type: 'file',
          parentId,
          name: entry.name,
          createdAt: this.getCreatedTime(entryPath),
          modifiedAt: this.getModifiedTime(entryPath),
          size: fileStat.size
        });
        stats.files++;
      }
    }

    return stats;
  }

  private getDirectories(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) return [];

    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('_'))
      .map(d => d.name);
  }

  private loadMetadata<T>(dirPath: string, filename = '_site.json'): T | undefined {
    const metaPath = path.join(dirPath, filename);
    if (!fs.existsSync(metaPath)) return undefined;

    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as T;
    } catch {
      return undefined;
    }
  }

  private getCreatedTime(fsPath: string): string {
    try {
      return fs.statSync(fsPath).birthtime.toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  private getModifiedTime(fsPath: string): string {
    try {
      return fs.statSync(fsPath).mtime.toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  getAbsolutePath(relPath: string): string {
    return path.join(this.root, relPath);
  }

  fileExists(relPath: string): boolean {
    return fs.existsSync(this.getAbsolutePath(relPath));
  }

  readFile(relPath: string): Buffer {
    return fs.readFileSync(this.getAbsolutePath(relPath));
  }

  writeFile(relPath: string, content: Buffer | string): void {
    const absPath = this.getAbsolutePath(relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
  }

  deleteFile(relPath: string): void {
    fs.unlinkSync(this.getAbsolutePath(relPath));
  }
}
```

**Step 4: Update services index**

Update `src/services/index.ts`:
```typescript
export { createDatabase, Database, ItemRecord, FieldValue } from './database.js';
export { FilesystemService } from './filesystem.js';
```

**Step 5: Run tests to verify they pass**

Run:
```bash
npm run test:run -- tests/services/filesystem.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add filesystem scanner service with hierarchy detection"
```

---

## Task 7: Basic Express Server

**Files:**
- Create: `src/server.ts`
- Create: `src/middleware/odata.ts`
- Create: `src/middleware/error.ts`
- Create: `tests/server.test.ts`

**Step 1: Write failing test for server**

Create file `tests/server.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../src/server.js';
import * as fs from 'fs';
import * as path from 'path';

describe('MockServer', () => {
  const testDir = './test-tmp';
  let server: MockServer;

  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, 'data/contoso/main/Documents'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'data/contoso/main/Documents/test.txt'), 'hello');

    server = createMockServer({
      port: 5099,
      root: path.join(testDir, 'data'),
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

  it('responds to health check', async () => {
    const response = await fetch('http://localhost:5099/health');
    expect(response.ok).toBe(true);
  });

  it('returns OData-formatted response for sites', async () => {
    const response = await fetch('http://localhost:5099/v1.0/sites');
    const data = await response.json();

    expect(data).toHaveProperty('@odata.context');
    expect(data).toHaveProperty('value');
    expect(Array.isArray(data.value)).toBe(true);
  });

  it('returns 404 for unknown routes', async () => {
    const response = await fetch('http://localhost:5099/v1.0/unknown');
    expect(response.status).toBe(404);

    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error).toHaveProperty('code');
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- tests/server.test.ts
```
Expected: FAIL - module not found

**Step 3: Create OData middleware**

Create file `src/middleware/odata.ts`:
```typescript
import { Request, Response, NextFunction } from 'express';

export interface ODataParams {
  select?: string[];
  expand?: string[];
  top?: number;
  skip?: number;
  filter?: string;
  orderby?: string;
}

export function parseODataParams(req: Request, res: Response, next: NextFunction): void {
  const params: ODataParams = {};

  if (req.query.$select) {
    params.select = (req.query.$select as string).split(',').map(s => s.trim());
  }

  if (req.query.$expand) {
    params.expand = (req.query.$expand as string).split(',').map(s => s.trim());
  }

  if (req.query.$top) {
    params.top = parseInt(req.query.$top as string, 10);
  }

  if (req.query.$skip) {
    params.skip = parseInt(req.query.$skip as string, 10);
  }

  if (req.query.$filter) {
    params.filter = req.query.$filter as string;
  }

  if (req.query.$orderby) {
    params.orderby = req.query.$orderby as string;
  }

  (req as any).odata = params;
  next();
}

export function applySelect<T extends Record<string, any>>(items: T[], fields?: string[]): Partial<T>[] {
  if (!fields || fields.length === 0) return items;

  return items.map(item => {
    const result: Partial<T> = {};
    for (const field of fields) {
      if (field in item) {
        (result as any)[field] = item[field];
      }
    }
    return result;
  });
}

export function applyPagination<T>(items: T[], top?: number, skip?: number): T[] {
  let result = items;

  if (skip && skip > 0) {
    result = result.slice(skip);
  }

  if (top && top > 0) {
    result = result.slice(0, top);
  }

  return result;
}

export function formatODataResponse(
  baseUrl: string,
  entitySet: string,
  value: any[],
  options?: { nextLink?: string }
): object {
  const response: Record<string, any> = {
    '@odata.context': `${baseUrl}/v1.0/$metadata#${entitySet}`,
    value
  };

  if (options?.nextLink) {
    response['@odata.nextLink'] = options.nextLink;
  }

  return response;
}
```

**Step 4: Create error middleware**

Create file `src/middleware/error.ts`:
```typescript
import { Request, Response, NextFunction } from 'express';

export class GraphError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

export function notFound(): GraphError {
  return new GraphError('itemNotFound', 'The resource could not be found.', 404);
}

export function badRequest(message: string): GraphError {
  return new GraphError('badRequest', message, 400);
}

export function unauthorized(): GraphError {
  return new GraphError('unauthenticated', 'Authentication required.', 401);
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (err instanceof GraphError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message
      }
    });
    return;
  }

  console.error('Unexpected error:', err);
  res.status(500).json({
    error: {
      code: 'internalServerError',
      message: 'An unexpected error occurred.'
    }
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'itemNotFound',
      message: `The resource '${req.path}' could not be found.`
    }
  });
}
```

**Step 5: Create server**

Create file `src/server.ts`:
```typescript
import express, { Express } from 'express';
import { Server } from 'http';
import { Config } from './config/index.js';
import { createDatabase, Database, FilesystemService } from './services/index.js';
import { createLogger, Logger } from './utils/index.js';
import { parseODataParams, formatODataResponse } from './middleware/odata.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

export interface MockServer {
  app: Express;
  start(): Promise<void>;
  stop(): Promise<void>;
  getPort(): number;
}

export interface ServerContext {
  config: Config;
  db: Database;
  fs: FilesystemService;
  logger: Logger;
}

export function createMockServer(config: Config): MockServer {
  const app = express();
  const logger = createLogger(config.logging);
  const db = createDatabase(config.database);
  const fsService = new FilesystemService(config.root, db);

  let server: Server | null = null;

  const ctx: ServerContext = { config, db, fs: fsService, logger };

  // Middleware
  app.use(express.json());
  app.use(parseODataParams);

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
  });

  // Placeholder sites endpoint (will be expanded in Task 8)
  app.get('/v1.0/sites', (req, res) => {
    const sites = db.getItemsByType('siteCollection');
    const baseUrl = `http://localhost:${config.port}`;

    const value = sites.map(site => ({
      id: site.id,
      name: site.name,
      displayName: site.name,
      webUrl: `${baseUrl}/sites/${site.name}`
    }));

    res.json(formatODataResponse(baseUrl, 'sites', value));
  });

  // Error handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  return {
    app,

    async start(): Promise<void> {
      // Scan filesystem on startup
      const stats = fsService.scan();
      logger.info(`Discovered: ${stats.siteCollections} site collections, ${stats.sites} sites, ${stats.libraries} libraries, ${stats.files} files`);

      return new Promise((resolve) => {
        server = app.listen(config.port, () => {
          logger.info(`Mock SharePoint Server started on http://localhost:${config.port}`);
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (server) {
          server.close((err) => {
            db.close();
            if (err) reject(err);
            else resolve();
          });
        } else {
          db.close();
          resolve();
        }
      });
    },

    getPort(): number {
      return config.port;
    }
  };
}
```

**Step 6: Update main index**

Update `src/index.ts`:
```typescript
export { createMockServer, MockServer, ServerContext } from './server.js';
export { Config, CliOptions, loadConfig, DEFAULT_CONFIG } from './config/index.js';
export { createDatabase, Database, FilesystemService } from './services/index.js';
export const VERSION = '1.0.0';
```

**Step 7: Run tests to verify they pass**

Run:
```bash
npm run test:run -- tests/server.test.ts
```
Expected: PASS

**Step 8: Commit**

```bash
git add -A && git commit -m "feat: add Express server with health check and basic sites endpoint"
```

---

## Task 8: Sites Routes

**Files:**
- Create: `src/routes/sites.ts`
- Modify: `src/server.ts`
- Create: `tests/routes/sites.test.ts`

**Step 1: Write failing test for sites routes**

Create file `tests/routes/sites.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../../src/server.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Sites Routes', () => {
  const testDir = './test-tmp';
  let server: MockServer;
  const baseUrl = 'http://localhost:5098';

  beforeAll(async () => {
    // Create test structure
    fs.mkdirSync(path.join(testDir, 'data/contoso/main/Documents'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'data/contoso/marketing/Assets'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'data/fabrikam/root/Shared'), { recursive: true });

    fs.writeFileSync(
      path.join(testDir, 'data/contoso/_site.json'),
      JSON.stringify({ displayName: 'Contoso Inc', description: 'Main tenant' })
    );

    server = createMockServer({
      port: 5098,
      root: path.join(testDir, 'data'),
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

  describe('GET /v1.0/sites', () => {
    it('returns all site collections', async () => {
      const response = await fetch(`${baseUrl}/v1.0/sites`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.value.length).toBe(2);
    });

    it('supports $select', async () => {
      const response = await fetch(`${baseUrl}/v1.0/sites?$select=id,name`);
      const data = await response.json();

      expect(data.value[0]).toHaveProperty('id');
      expect(data.value[0]).toHaveProperty('name');
    });

    it('supports $top', async () => {
      const response = await fetch(`${baseUrl}/v1.0/sites?$top=1`);
      const data = await response.json();

      expect(data.value.length).toBe(1);
    });
  });

  describe('GET /v1.0/sites/:siteId', () => {
    it('returns site by ID', async () => {
      // First get the site ID
      const listResponse = await fetch(`${baseUrl}/v1.0/sites`);
      const listData = await listResponse.json();
      const siteId = listData.value[0].id;

      const response = await fetch(`${baseUrl}/v1.0/sites/${siteId}`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.id).toBe(siteId);
    });

    it('returns 404 for unknown site', async () => {
      const response = await fetch(`${baseUrl}/v1.0/sites/unknown-id`);
      expect(response.status).toBe(404);
    });
  });

  describe('GET /v1.0/sites/:siteId/sites', () => {
    it('returns subsites', async () => {
      const listResponse = await fetch(`${baseUrl}/v1.0/sites`);
      const listData = await listResponse.json();
      const contoso = listData.value.find((s: any) => s.name === 'contoso');

      const response = await fetch(`${baseUrl}/v1.0/sites/${contoso.id}/sites`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.value.length).toBe(2); // main and marketing
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- tests/routes/sites.test.ts
```
Expected: FAIL - routes not implemented

**Step 3: Implement sites routes**

Create file `src/routes/sites.ts`:
```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { ServerContext } from '../server.js';
import { formatODataResponse, applySelect, applyPagination, ODataParams } from '../middleware/odata.js';
import { notFound } from '../middleware/error.js';

export function createSitesRouter(ctx: ServerContext): Router {
  const router = Router();
  const { db, config } = ctx;
  const baseUrl = `http://localhost:${config.port}`;

  // GET /v1.0/sites - List all site collections
  router.get('/', (req: Request, res: Response) => {
    const odata = (req as any).odata as ODataParams;
    const siteCollections = db.getItemsByType('siteCollection');

    let value = siteCollections.map(sc => {
      const fields = db.getFieldValues(sc.id);
      const displayName = fields.find(f => f.fieldName === 'displayName')?.fieldValue || sc.name;
      const description = fields.find(f => f.fieldName === 'description')?.fieldValue || '';

      return {
        id: sc.id,
        name: sc.name,
        displayName,
        description,
        webUrl: `${baseUrl}/sites/${sc.name}`,
        createdDateTime: sc.createdAt,
        lastModifiedDateTime: sc.modifiedAt
      };
    });

    value = applyPagination(value, odata.top, odata.skip);
    value = applySelect(value, odata.select) as typeof value;

    res.json(formatODataResponse(baseUrl, 'sites', value));
  });

  // GET /v1.0/sites/:siteId - Get site by ID
  router.get('/:siteId', (req: Request, res: Response, next: NextFunction) => {
    const { siteId } = req.params;

    // Try to find as site collection first, then as site
    let item = db.getItemById(siteId);

    if (!item || (item.type !== 'siteCollection' && item.type !== 'site')) {
      return next(notFound());
    }

    const fields = db.getFieldValues(item.id);
    const displayName = fields.find(f => f.fieldName === 'displayName')?.fieldValue || item.name;
    const description = fields.find(f => f.fieldName === 'description')?.fieldValue || '';

    res.json({
      '@odata.context': `${baseUrl}/v1.0/$metadata#sites/$entity`,
      id: item.id,
      name: item.name,
      displayName,
      description,
      webUrl: `${baseUrl}/sites/${item.path}`,
      createdDateTime: item.createdAt,
      lastModifiedDateTime: item.modifiedAt
    });
  });

  // GET /v1.0/sites/:siteId/sites - Get subsites
  router.get('/:siteId/sites', (req: Request, res: Response, next: NextFunction) => {
    const { siteId } = req.params;
    const odata = (req as any).odata as ODataParams;

    const parent = db.getItemById(siteId);
    if (!parent) {
      return next(notFound());
    }

    const children = db.getItemsByParent(siteId).filter(c => c.type === 'site');

    let value = children.map(site => {
      const fields = db.getFieldValues(site.id);
      const displayName = fields.find(f => f.fieldName === 'displayName')?.fieldValue || site.name;

      return {
        id: site.id,
        name: site.name,
        displayName,
        webUrl: `${baseUrl}/sites/${site.path}`,
        createdDateTime: site.createdAt,
        lastModifiedDateTime: site.modifiedAt
      };
    });

    value = applyPagination(value, odata.top, odata.skip);
    value = applySelect(value, odata.select) as typeof value;

    res.json(formatODataResponse(baseUrl, 'sites', value));
  });

  return router;
}
```

**Step 4: Update server to use sites router**

Update `src/server.ts` to import and use the sites router:

Add import:
```typescript
import { createSitesRouter } from './routes/sites.js';
```

Replace the placeholder `/v1.0/sites` route with:
```typescript
  // Routes
  app.use('/v1.0/sites', createSitesRouter(ctx));
```

**Step 5: Run tests to verify they pass**

Run:
```bash
npm run test:run -- tests/routes/sites.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add sites routes with GET, subsites, and OData support"
```

---

## Task 9: Lists Routes

**Files:**
- Create: `src/routes/lists.ts`
- Modify: `src/server.ts`
- Create: `tests/routes/lists.test.ts`

**Step 1: Write failing test for lists routes**

Create file `tests/routes/lists.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../../src/server.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Lists Routes', () => {
  const testDir = './test-tmp';
  let server: MockServer;
  const baseUrl = 'http://localhost:5097';
  let siteId: string;
  let listId: string;

  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, 'data/contoso/main/Documents'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'data/contoso/main/Tasks'), { recursive: true });

    fs.writeFileSync(
      path.join(testDir, 'data/contoso/main/Documents/_library.json'),
      JSON.stringify({ displayName: 'Shared Documents' })
    );

    fs.writeFileSync(
      path.join(testDir, 'data/contoso/main/Tasks/_list.json'),
      JSON.stringify({ displayName: 'Task List', columns: [{ name: 'Title', type: 'text' }] })
    );

    fs.writeFileSync(
      path.join(testDir, 'data/contoso/main/Tasks/_items.json'),
      JSON.stringify([
        { id: 'item-1', fields: { Title: 'First task' } },
        { id: 'item-2', fields: { Title: 'Second task' } }
      ])
    );

    server = createMockServer({
      port: 5097,
      root: path.join(testDir, 'data'),
      auth: { mode: 'none' },
      database: path.join(testDir, 'test.db'),
      logging: 'error'
    });
    await server.start();

    // Get site ID for tests
    const sitesResp = await fetch(`${baseUrl}/v1.0/sites`);
    const sitesData = await sitesResp.json();
    const contoso = sitesData.value.find((s: any) => s.name === 'contoso');

    const subsitesResp = await fetch(`${baseUrl}/v1.0/sites/${contoso.id}/sites`);
    const subsitesData = await subsitesResp.json();
    siteId = subsitesData.value.find((s: any) => s.name === 'main').id;
  });

  afterAll(async () => {
    await server.stop();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('GET /v1.0/sites/:siteId/lists', () => {
    it('returns all lists in site', async () => {
      const response = await fetch(`${baseUrl}/v1.0/sites/${siteId}/lists`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.value.length).toBe(2); // Documents and Tasks
    });
  });

  describe('GET /v1.0/sites/:siteId/lists/:listId', () => {
    it('returns list by ID', async () => {
      const listsResp = await fetch(`${baseUrl}/v1.0/sites/${siteId}/lists`);
      const listsData = await listsResp.json();
      listId = listsData.value[0].id;

      const response = await fetch(`${baseUrl}/v1.0/sites/${siteId}/lists/${listId}`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.id).toBe(listId);
    });
  });

  describe('GET /v1.0/sites/:siteId/lists/:listId/items', () => {
    it('returns items in list', async () => {
      const listsResp = await fetch(`${baseUrl}/v1.0/sites/${siteId}/lists`);
      const listsData = await listsResp.json();
      const tasksList = listsData.value.find((l: any) => l.name === 'Tasks');

      const response = await fetch(`${baseUrl}/v1.0/sites/${siteId}/lists/${tasksList.id}/items`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.value.length).toBe(2);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- tests/routes/lists.test.ts
```
Expected: FAIL - routes not implemented

**Step 3: Update filesystem service to load list items**

Add to `src/services/filesystem.ts` in the `FilesystemService` class:

```typescript
  loadListItems(listPath: string): Array<{ id: string; fields: Record<string, any> }> {
    const itemsPath = path.join(this.root, listPath, '_items.json');
    if (!fs.existsSync(itemsPath)) return [];

    try {
      return JSON.parse(fs.readFileSync(itemsPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  saveListItems(listPath: string, items: Array<{ id: string; fields: Record<string, any> }>): void {
    const itemsPath = path.join(this.root, listPath, '_items.json');
    fs.writeFileSync(itemsPath, JSON.stringify(items, null, 2));
  }
```

**Step 4: Implement lists routes**

Create file `src/routes/lists.ts`:
```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { ServerContext } from '../server.js';
import { formatODataResponse, applySelect, applyPagination, ODataParams } from '../middleware/odata.js';
import { notFound, badRequest } from '../middleware/error.js';
import { generateId } from '../utils/id.js';

export function createListsRouter(ctx: ServerContext): Router {
  const router = Router({ mergeParams: true });
  const { db, fs: fsService, config } = ctx;
  const baseUrl = `http://localhost:${config.port}`;

  // GET /v1.0/sites/:siteId/lists
  router.get('/', (req: Request, res: Response, next: NextFunction) => {
    const { siteId } = req.params;
    const odata = (req as any).odata as ODataParams;

    const site = db.getItemById(siteId);
    if (!site) return next(notFound());

    const lists = db.getItemsByParent(siteId).filter(
      c => c.type === 'library' || c.type === 'list'
    );

    let value = lists.map(list => {
      const fields = db.getFieldValues(list.id);
      const displayName = fields.find(f => f.fieldName === 'displayName')?.fieldValue || list.name;

      return {
        id: list.id,
        name: list.name,
        displayName,
        list: { template: list.type === 'library' ? 'documentLibrary' : 'genericList' },
        createdDateTime: list.createdAt,
        lastModifiedDateTime: list.modifiedAt
      };
    });

    value = applyPagination(value, odata.top, odata.skip);
    value = applySelect(value, odata.select) as typeof value;

    res.json(formatODataResponse(baseUrl, 'lists', value));
  });

  // GET /v1.0/sites/:siteId/lists/:listId
  router.get('/:listId', (req: Request, res: Response, next: NextFunction) => {
    const { listId } = req.params;

    const list = db.getItemById(listId);
    if (!list || (list.type !== 'library' && list.type !== 'list')) {
      return next(notFound());
    }

    const fields = db.getFieldValues(list.id);
    const displayName = fields.find(f => f.fieldName === 'displayName')?.fieldValue || list.name;

    res.json({
      '@odata.context': `${baseUrl}/v1.0/$metadata#lists/$entity`,
      id: list.id,
      name: list.name,
      displayName,
      list: { template: list.type === 'library' ? 'documentLibrary' : 'genericList' },
      createdDateTime: list.createdAt,
      lastModifiedDateTime: list.modifiedAt
    });
  });

  // GET /v1.0/sites/:siteId/lists/:listId/items
  router.get('/:listId/items', (req: Request, res: Response, next: NextFunction) => {
    const { listId } = req.params;
    const odata = (req as any).odata as ODataParams;

    const list = db.getItemById(listId);
    if (!list) return next(notFound());

    // For libraries, items are files
    if (list.type === 'library') {
      const files = db.getItemsByParent(listId);
      let value = files.map(file => ({
        id: file.id,
        fields: {
          Title: file.name,
          FileLeafRef: file.name
        },
        createdDateTime: file.createdAt,
        lastModifiedDateTime: file.modifiedAt
      }));

      value = applyPagination(value, odata.top, odata.skip);
      return res.json(formatODataResponse(baseUrl, 'listItems', value));
    }

    // For lists, load from _items.json
    const items = fsService.loadListItems(list.path);
    let value = items.map(item => ({
      id: item.id,
      fields: item.fields,
      createdDateTime: new Date().toISOString(),
      lastModifiedDateTime: new Date().toISOString()
    }));

    value = applyPagination(value, odata.top, odata.skip);
    res.json(formatODataResponse(baseUrl, 'listItems', value));
  });

  // POST /v1.0/sites/:siteId/lists/:listId/items
  router.post('/:listId/items', (req: Request, res: Response, next: NextFunction) => {
    const { listId } = req.params;
    const { fields } = req.body;

    if (!fields) return next(badRequest('Missing fields in request body'));

    const list = db.getItemById(listId);
    if (!list) return next(notFound());

    const items = fsService.loadListItems(list.path);
    const newItem = {
      id: generateId(`${list.path}/${Date.now()}`),
      fields
    };
    items.push(newItem);
    fsService.saveListItems(list.path, items);

    res.status(201).json({
      '@odata.context': `${baseUrl}/v1.0/$metadata#listItems/$entity`,
      id: newItem.id,
      fields: newItem.fields,
      createdDateTime: new Date().toISOString(),
      lastModifiedDateTime: new Date().toISOString()
    });
  });

  // PATCH /v1.0/sites/:siteId/lists/:listId/items/:itemId
  router.patch('/:listId/items/:itemId', (req: Request, res: Response, next: NextFunction) => {
    const { listId, itemId } = req.params;
    const { fields } = req.body;

    const list = db.getItemById(listId);
    if (!list) return next(notFound());

    const items = fsService.loadListItems(list.path);
    const itemIndex = items.findIndex(i => i.id === itemId);

    if (itemIndex === -1) return next(notFound());

    items[itemIndex].fields = { ...items[itemIndex].fields, ...fields };
    fsService.saveListItems(list.path, items);

    res.json({
      '@odata.context': `${baseUrl}/v1.0/$metadata#listItems/$entity`,
      id: itemId,
      fields: items[itemIndex].fields,
      lastModifiedDateTime: new Date().toISOString()
    });
  });

  // DELETE /v1.0/sites/:siteId/lists/:listId/items/:itemId
  router.delete('/:listId/items/:itemId', (req: Request, res: Response, next: NextFunction) => {
    const { listId, itemId } = req.params;

    const list = db.getItemById(listId);
    if (!list) return next(notFound());

    const items = fsService.loadListItems(list.path);
    const itemIndex = items.findIndex(i => i.id === itemId);

    if (itemIndex === -1) return next(notFound());

    items.splice(itemIndex, 1);
    fsService.saveListItems(list.path, items);

    res.status(204).send();
  });

  return router;
}
```

**Step 5: Update server to use lists router**

Add import to `src/server.ts`:
```typescript
import { createListsRouter } from './routes/lists.js';
```

Add route after sites router:
```typescript
  app.use('/v1.0/sites/:siteId/lists', createListsRouter(ctx));
```

**Step 6: Run tests to verify they pass**

Run:
```bash
npm run test:run -- tests/routes/lists.test.ts
```
Expected: PASS

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: add lists routes with items CRUD operations"
```

---

## Task 10: Drives Routes

**Files:**
- Create: `src/routes/drives.ts`
- Modify: `src/server.ts`
- Create: `tests/routes/drives.test.ts`

**Step 1: Write failing test for drives routes**

Create file `tests/routes/drives.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../../src/server.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Drives Routes', () => {
  const testDir = './test-tmp';
  let server: MockServer;
  const baseUrl = 'http://localhost:5096';
  let siteId: string;
  let driveId: string;

  beforeAll(async () => {
    fs.mkdirSync(path.join(testDir, 'data/contoso/main/Documents/Reports'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'data/contoso/main/Documents/readme.txt'), 'Hello World');
    fs.writeFileSync(path.join(testDir, 'data/contoso/main/Documents/Reports/q1.pdf'), 'PDF content');

    server = createMockServer({
      port: 5096,
      root: path.join(testDir, 'data'),
      auth: { mode: 'none' },
      database: path.join(testDir, 'test.db'),
      logging: 'error'
    });
    await server.start();

    // Get IDs for tests
    const sitesResp = await fetch(`${baseUrl}/v1.0/sites`);
    const sitesData = await sitesResp.json();
    const contoso = sitesData.value.find((s: any) => s.name === 'contoso');

    const subsitesResp = await fetch(`${baseUrl}/v1.0/sites/${contoso.id}/sites`);
    const subsitesData = await subsitesResp.json();
    siteId = subsitesData.value.find((s: any) => s.name === 'main').id;
  });

  afterAll(async () => {
    await server.stop();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('GET /v1.0/sites/:siteId/drives', () => {
    it('returns all drives in site', async () => {
      const response = await fetch(`${baseUrl}/v1.0/sites/${siteId}/drives`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.value.length).toBeGreaterThan(0);
      driveId = data.value[0].id;
    });
  });

  describe('GET /v1.0/drives/:driveId/root/children', () => {
    it('returns root folder contents', async () => {
      const response = await fetch(`${baseUrl}/v1.0/drives/${driveId}/root/children`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.value.length).toBe(2); // readme.txt and Reports folder
    });
  });

  describe('GET /v1.0/drives/:driveId/items/:itemId/content', () => {
    it('downloads file content', async () => {
      const childrenResp = await fetch(`${baseUrl}/v1.0/drives/${driveId}/root/children`);
      const childrenData = await childrenResp.json();
      const file = childrenData.value.find((i: any) => i.name === 'readme.txt');

      const response = await fetch(`${baseUrl}/v1.0/drives/${driveId}/items/${file.id}/content`);
      const text = await response.text();

      expect(response.ok).toBe(true);
      expect(text).toBe('Hello World');
    });
  });

  describe('PUT /v1.0/drives/:driveId/items/:itemId/content', () => {
    it('uploads file content', async () => {
      const childrenResp = await fetch(`${baseUrl}/v1.0/drives/${driveId}/root/children`);
      const childrenData = await childrenResp.json();
      const file = childrenData.value.find((i: any) => i.name === 'readme.txt');

      const response = await fetch(`${baseUrl}/v1.0/drives/${driveId}/items/${file.id}/content`, {
        method: 'PUT',
        body: 'Updated content'
      });

      expect(response.ok).toBe(true);

      // Verify content was updated
      const getResp = await fetch(`${baseUrl}/v1.0/drives/${driveId}/items/${file.id}/content`);
      const text = await getResp.text();
      expect(text).toBe('Updated content');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- tests/routes/drives.test.ts
```
Expected: FAIL - routes not implemented

**Step 3: Implement drives routes**

Create file `src/routes/drives.ts`:
```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { ServerContext } from '../server.js';
import { formatODataResponse, applyPagination, ODataParams } from '../middleware/odata.js';
import { notFound } from '../middleware/error.js';

export function createDrivesRouter(ctx: ServerContext): Router {
  const router = Router({ mergeParams: true });
  const { db, fs: fsService, config } = ctx;
  const baseUrl = `http://localhost:${config.port}`;

  // Helper to format drive item
  const formatDriveItem = (item: any) => {
    const isFolder = item.type === 'folder' || item.type === 'library';
    const result: any = {
      id: item.id,
      name: item.name,
      createdDateTime: item.createdAt,
      lastModifiedDateTime: item.modifiedAt,
      webUrl: `${baseUrl}/drives/${item.id}`
    };

    if (isFolder) {
      result.folder = { childCount: db.getItemsByParent(item.id).length };
    } else {
      result.file = { mimeType: 'application/octet-stream' };
      result.size = item.size || 0;
    }

    return result;
  };

  // GET /v1.0/sites/:siteId/drives
  router.get('/', (req: Request, res: Response, next: NextFunction) => {
    const { siteId } = req.params;

    const site = db.getItemById(siteId);
    if (!site) return next(notFound());

    const libraries = db.getItemsByParent(siteId).filter(c => c.type === 'library');

    const value = libraries.map(lib => ({
      id: lib.id,
      name: lib.name,
      driveType: 'documentLibrary',
      createdDateTime: lib.createdAt,
      lastModifiedDateTime: lib.modifiedAt
    }));

    res.json(formatODataResponse(baseUrl, 'drives', value));
  });

  // GET /v1.0/sites/:siteId/drive (default drive)
  router.get('/drive', (req: Request, res: Response, next: NextFunction) => {
    const { siteId } = req.params;

    const site = db.getItemById(siteId);
    if (!site) return next(notFound());

    const libraries = db.getItemsByParent(siteId).filter(c => c.type === 'library');
    if (libraries.length === 0) return next(notFound());

    const lib = libraries[0];
    res.json({
      '@odata.context': `${baseUrl}/v1.0/$metadata#drives/$entity`,
      id: lib.id,
      name: lib.name,
      driveType: 'documentLibrary',
      createdDateTime: lib.createdAt,
      lastModifiedDateTime: lib.modifiedAt
    });
  });

  return router;
}

export function createDriveItemsRouter(ctx: ServerContext): Router {
  const router = Router({ mergeParams: true });
  const { db, fs: fsService, config } = ctx;
  const baseUrl = `http://localhost:${config.port}`;

  const formatDriveItem = (item: any) => {
    const isFolder = item.type === 'folder' || item.type === 'library';
    const result: any = {
      id: item.id,
      name: item.name,
      createdDateTime: item.createdAt,
      lastModifiedDateTime: item.modifiedAt,
      webUrl: `${baseUrl}/drives/${item.id}`
    };

    if (isFolder) {
      result.folder = { childCount: db.getItemsByParent(item.id).length };
    } else {
      result.file = { mimeType: 'application/octet-stream' };
      result.size = item.size || 0;
    }

    return result;
  };

  // GET /v1.0/drives/:driveId/root/children
  router.get('/:driveId/root/children', (req: Request, res: Response, next: NextFunction) => {
    const { driveId } = req.params;
    const odata = (req as any).odata as ODataParams;

    const drive = db.getItemById(driveId);
    if (!drive || drive.type !== 'library') return next(notFound());

    const children = db.getItemsByParent(driveId);
    let value = children.map(formatDriveItem);

    value = applyPagination(value, odata.top, odata.skip);
    res.json(formatODataResponse(baseUrl, 'driveItems', value));
  });

  // GET /v1.0/drives/:driveId/items/:itemId
  router.get('/:driveId/items/:itemId', (req: Request, res: Response, next: NextFunction) => {
    const { itemId } = req.params;

    const item = db.getItemById(itemId);
    if (!item) return next(notFound());

    res.json({
      '@odata.context': `${baseUrl}/v1.0/$metadata#driveItems/$entity`,
      ...formatDriveItem(item)
    });
  });

  // GET /v1.0/drives/:driveId/items/:itemId/children
  router.get('/:driveId/items/:itemId/children', (req: Request, res: Response, next: NextFunction) => {
    const { itemId } = req.params;
    const odata = (req as any).odata as ODataParams;

    const item = db.getItemById(itemId);
    if (!item) return next(notFound());

    const children = db.getItemsByParent(itemId);
    let value = children.map(formatDriveItem);

    value = applyPagination(value, odata.top, odata.skip);
    res.json(formatODataResponse(baseUrl, 'driveItems', value));
  });

  // GET /v1.0/drives/:driveId/items/:itemId/content
  router.get('/:driveId/items/:itemId/content', (req: Request, res: Response, next: NextFunction) => {
    const { itemId } = req.params;

    const item = db.getItemById(itemId);
    if (!item || item.type !== 'file') return next(notFound());

    if (!fsService.fileExists(item.path)) return next(notFound());

    const content = fsService.readFile(item.path);
    res.type('application/octet-stream').send(content);
  });

  // PUT /v1.0/drives/:driveId/items/:itemId/content
  router.put('/:driveId/items/:itemId/content', async (req: Request, res: Response, next: NextFunction) => {
    const { driveId, itemId } = req.params;

    const item = db.getItemById(itemId);
    if (!item || item.type !== 'file') return next(notFound());

    // Read body as buffer
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks);

    fsService.writeFile(item.path, content);

    // Update item in database
    db.upsertItem({
      ...item,
      modifiedAt: new Date().toISOString(),
      size: content.length
    });

    res.json({
      '@odata.context': `${baseUrl}/v1.0/$metadata#driveItems/$entity`,
      id: item.id,
      name: item.name,
      size: content.length,
      lastModifiedDateTime: new Date().toISOString()
    });
  });

  // DELETE /v1.0/drives/:driveId/items/:itemId
  router.delete('/:driveId/items/:itemId', (req: Request, res: Response, next: NextFunction) => {
    const { itemId } = req.params;

    const item = db.getItemById(itemId);
    if (!item) return next(notFound());

    if (item.type === 'file' && fsService.fileExists(item.path)) {
      fsService.deleteFile(item.path);
    }

    db.deleteItem(itemId);
    res.status(204).send();
  });

  return router;
}
```

**Step 4: Update server to use drives router**

Add imports to `src/server.ts`:
```typescript
import { createDrivesRouter, createDriveItemsRouter } from './routes/drives.js';
```

Add routes:
```typescript
  app.use('/v1.0/sites/:siteId/drives', createDrivesRouter(ctx));
  app.use('/v1.0/sites/:siteId', createDrivesRouter(ctx)); // for /drive endpoint
  app.use('/v1.0/drives', createDriveItemsRouter(ctx));
```

**Step 5: Run tests to verify they pass**

Run:
```bash
npm run test:run -- tests/routes/drives.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add drives routes with file upload/download"
```

---

## Task 11: Authentication Middleware

**Files:**
- Create: `src/middleware/auth.ts`
- Modify: `src/server.ts`
- Create: `src/routes/auth.ts`
- Create: `tests/middleware/auth.test.ts`

**Step 1: Write failing test for auth middleware**

Create file `tests/middleware/auth.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockServer, MockServer } from '../../src/server.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Authentication', () => {
  const testDir = './test-tmp';

  describe('mode: none', () => {
    let server: MockServer;

    beforeAll(async () => {
      fs.mkdirSync(path.join(testDir, 'data/contoso/main/Documents'), { recursive: true });
      server = createMockServer({
        port: 5094,
        root: path.join(testDir, 'data'),
        auth: { mode: 'none' },
        database: path.join(testDir, 'none.db'),
        logging: 'error'
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('allows requests without auth header', async () => {
      const response = await fetch('http://localhost:5094/v1.0/sites');
      expect(response.ok).toBe(true);
    });
  });

  describe('mode: static', () => {
    let server: MockServer;

    beforeAll(async () => {
      fs.mkdirSync(path.join(testDir, 'data2/contoso/main/Documents'), { recursive: true });
      server = createMockServer({
        port: 5093,
        root: path.join(testDir, 'data2'),
        auth: { mode: 'static', tokens: ['valid-token', 'another-token'] },
        database: path.join(testDir, 'static.db'),
        logging: 'error'
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('rejects requests without auth header', async () => {
      const response = await fetch('http://localhost:5093/v1.0/sites');
      expect(response.status).toBe(401);
    });

    it('rejects requests with invalid token', async () => {
      const response = await fetch('http://localhost:5093/v1.0/sites', {
        headers: { Authorization: 'Bearer invalid-token' }
      });
      expect(response.status).toBe(401);
    });

    it('accepts requests with valid token', async () => {
      const response = await fetch('http://localhost:5093/v1.0/sites', {
        headers: { Authorization: 'Bearer valid-token' }
      });
      expect(response.ok).toBe(true);
    });
  });

  describe('mode: oauth', () => {
    let server: MockServer;

    beforeAll(async () => {
      fs.mkdirSync(path.join(testDir, 'data3/contoso/main/Documents'), { recursive: true });
      server = createMockServer({
        port: 5092,
        root: path.join(testDir, 'data3'),
        auth: { mode: 'oauth' },
        database: path.join(testDir, 'oauth.db'),
        logging: 'error'
      });
      await server.start();
    });

    afterAll(async () => {
      await server.stop();
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('provides token endpoint', async () => {
      const response = await fetch('http://localhost:5092/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&client_id=test&client_secret=test'
      });
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data).toHaveProperty('access_token');
      expect(data).toHaveProperty('token_type', 'Bearer');
    });

    it('accepts token from oauth endpoint', async () => {
      const tokenResp = await fetch('http://localhost:5092/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&client_id=test&client_secret=test'
      });
      const tokenData = await tokenResp.json();

      const response = await fetch('http://localhost:5092/v1.0/sites', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      expect(response.ok).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- tests/middleware/auth.test.ts
```
Expected: FAIL - auth not implemented

**Step 3: Implement auth middleware**

Create file `src/middleware/auth.ts`:
```typescript
import { Request, Response, NextFunction } from 'express';
import { AuthConfig } from '../config/types.js';
import { unauthorized } from './error.js';

const validOAuthTokens = new Set<string>();

export function createAuthMiddleware(authConfig: AuthConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip auth for health check and oauth endpoints
    if (req.path === '/health' || req.path.startsWith('/oauth')) {
      return next();
    }

    if (authConfig.mode === 'none') {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(unauthorized());
    }

    const token = authHeader.slice(7);

    if (authConfig.mode === 'static') {
      if (!authConfig.tokens || !authConfig.tokens.includes(token)) {
        return next(unauthorized());
      }
      return next();
    }

    if (authConfig.mode === 'oauth') {
      if (!validOAuthTokens.has(token)) {
        return next(unauthorized());
      }
      return next();
    }

    next();
  };
}

export function registerOAuthToken(token: string): void {
  validOAuthTokens.add(token);
}

export function revokeOAuthToken(token: string): void {
  validOAuthTokens.delete(token);
}
```

**Step 4: Implement OAuth routes**

Create file `src/routes/auth.ts`:
```typescript
import { Router, Request, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import { registerOAuthToken } from '../middleware/auth.js';

export function createAuthRouter(): Router {
  const router = Router();

  // POST /oauth/token
  router.post('/token', (req: Request, res: Response) => {
    // Generate a mock token
    const token = randomBytes(32).toString('hex');
    const expiresIn = 3600;

    // Register the token as valid
    registerOAuthToken(token);

    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      scope: 'Sites.ReadWrite.All'
    });
  });

  // GET /oauth/authorize (mock authorization endpoint)
  router.get('/authorize', (req: Request, res: Response) => {
    const { redirect_uri, state } = req.query;
    const code = randomBytes(16).toString('hex');

    if (redirect_uri) {
      const redirectUrl = new URL(redirect_uri as string);
      redirectUrl.searchParams.set('code', code);
      if (state) redirectUrl.searchParams.set('state', state as string);
      return res.redirect(redirectUrl.toString());
    }

    res.json({ code });
  });

  return router;
}
```

**Step 5: Update server to use auth**

Add imports to `src/server.ts`:
```typescript
import { createAuthMiddleware } from './middleware/auth.js';
import { createAuthRouter } from './routes/auth.js';
```

Add middleware and route after `app.use(parseODataParams)`:
```typescript
  // Auth
  app.use(createAuthMiddleware(config.auth));
  app.use('/oauth', createAuthRouter());
```

**Step 6: Run tests to verify they pass**

Run:
```bash
npm run test:run -- tests/middleware/auth.test.ts
```
Expected: PASS

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: add authentication middleware with none/static/oauth modes"
```

---

## Task 12: CLI

**Files:**
- Create: `src/bin/cli.ts`
- Modify: `package.json`
- Create: `tests/cli.test.ts`

**Step 1: Write failing test for CLI**

Create file `tests/cli.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

describe('CLI', () => {
  const testDir = './test-tmp';

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('init command', () => {
    it('creates sample directory structure', () => {
      execSync(`npx tsx src/bin/cli.ts init ${testDir}/my-sharepoint`, { encoding: 'utf-8' });

      expect(fs.existsSync(path.join(testDir, 'my-sharepoint/contoso/main/Documents'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'my-sharepoint/contoso/_site.json'))).toBe(true);
    });
  });

  describe('--version', () => {
    it('prints version', () => {
      const output = execSync('npx tsx src/bin/cli.ts --version', { encoding: 'utf-8' });
      expect(output.trim()).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('--help', () => {
    it('prints help', () => {
      const output = execSync('npx tsx src/bin/cli.ts --help', { encoding: 'utf-8' });
      expect(output).toContain('mock-sp-server');
      expect(output).toContain('--port');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- tests/cli.test.ts
```
Expected: FAIL - CLI not found

**Step 3: Implement CLI**

Create file `src/bin/cli.ts`:
```typescript
#!/usr/bin/env node

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { createMockServer, loadConfig, VERSION } from '../index.js';

program
  .name('mock-sp-server')
  .description('Mock SharePoint server for testing and development')
  .version(VERSION);

program
  .option('-p, --port <port>', 'Port to listen on', '5001')
  .option('-r, --root <path>', 'Root directory for SharePoint data', './data')
  .option('-a, --auth <mode>', 'Authentication mode (none, static, oauth)', 'none')
  .option('-d, --database <path>', 'SQLite database path', './mock-sp.db')
  .option('-l, --logging <level>', 'Log level (debug, info, warn, error)', 'info')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    const config = loadConfig({
      port: options.port ? parseInt(options.port, 10) : undefined,
      root: options.root,
      auth: options.auth as any,
      database: options.database,
      logging: options.logging as any,
      configFile: options.config
    });

    const server = createMockServer(config);

    console.log(`
Mock SharePoint Server v${VERSION}

Root:     ${config.root}
Database: ${config.database}
Auth:     ${config.auth.mode}
`);

    await server.start();

    console.log(`
Ready for requests.

Endpoints:
  http://localhost:${config.port}/v1.0/sites
  http://localhost:${config.port}/health
`);

    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await server.stop();
      process.exit(0);
    });
  });

program
  .command('init <directory>')
  .description('Initialize a sample SharePoint data directory')
  .action((directory) => {
    const absPath = path.resolve(directory);

    // Create directory structure
    const dirs = [
      'contoso/main/Documents',
      'contoso/main/Shared Documents',
      'contoso/marketing/Assets',
      'fabrikam/root/Documents'
    ];

    for (const dir of dirs) {
      fs.mkdirSync(path.join(absPath, dir), { recursive: true });
    }

    // Create metadata files
    fs.writeFileSync(
      path.join(absPath, 'contoso/_site.json'),
      JSON.stringify({ displayName: 'Contoso Inc', description: 'Main tenant site collection' }, null, 2)
    );

    fs.writeFileSync(
      path.join(absPath, 'contoso/main/_site.json'),
      JSON.stringify({ displayName: 'Main Site', description: 'Primary collaboration site' }, null, 2)
    );

    fs.writeFileSync(
      path.join(absPath, 'contoso/main/Documents/_library.json'),
      JSON.stringify({ displayName: 'Documents', description: 'Default document library' }, null, 2)
    );

    fs.writeFileSync(
      path.join(absPath, 'fabrikam/_site.json'),
      JSON.stringify({ displayName: 'Fabrikam', description: 'Partner site collection' }, null, 2)
    );

    // Create sample files
    fs.writeFileSync(
      path.join(absPath, 'contoso/main/Documents/Welcome.txt'),
      'Welcome to the Mock SharePoint Server!\n\nThis is a sample document.'
    );

    // Create sample config
    fs.writeFileSync(
      path.join(absPath, 'mock-sp.config.json'),
      JSON.stringify({
        port: 5001,
        root: absPath,
        auth: { mode: 'none' },
        database: path.join(absPath, 'mock-sp.db'),
        logging: 'info'
      }, null, 2)
    );

    console.log(`Initialized SharePoint data directory at ${absPath}

Created:
  - 2 site collections (contoso, fabrikam)
  - 3 sites
  - 4 document libraries
  - Sample files and metadata

To start the server:
  mock-sp-server --root ${absPath}
`);
  });

program.parse();
```

**Step 4: Run tests to verify they pass**

Run:
```bash
npm run test:run -- tests/cli.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add CLI with init command and server options"
```

---

## Task 13: Final Integration & Documentation

**Files:**
- Create: `README.md`
- Update: `package.json` (final metadata)
- Run all tests

**Step 1: Run all tests**

```bash
npm run test:run
```
Expected: All tests pass

**Step 2: Create README**

Create file `README.md`:
```markdown
# Mock SharePoint Server

A local Node.js server that mimics Microsoft Graph SharePoint endpoints for testing and development.

## Installation

```bash
npm install -g mock-sp-server
```

Or use directly with npx:

```bash
npx mock-sp-server
```

## Quick Start

```bash
# Initialize a sample data directory
npx mock-sp-server init ./my-sharepoint

# Start the server
npx mock-sp-server --root ./my-sharepoint

# Test an endpoint
curl http://localhost:5001/v1.0/sites
```

## Configuration

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port` | Port to listen on | 5001 |
| `-r, --root` | Root data directory | ./data |
| `-a, --auth` | Auth mode (none, static, oauth) | none |
| `-d, --database` | SQLite database path | ./mock-sp.db |
| `-l, --logging` | Log level | info |
| `-c, --config` | Config file path | ./mock-sp.config.json |

### Config File

```json
{
  "port": 5001,
  "root": "./data",
  "auth": {
    "mode": "none",
    "tokens": ["dev-token"]
  },
  "database": "./mock-sp.db",
  "logging": "info"
}
```

### Programmatic API

```typescript
import { createMockServer } from 'mock-sp-server';

const server = createMockServer({
  port: 5001,
  root: './test-fixtures',
  auth: { mode: 'none' },
  database: ':memory:',
  logging: 'error'
});

await server.start();
// ... run tests ...
await server.stop();
```

## Directory Structure

```
data/
├── contoso/                    # Site collection
│   ├── _site.json              # Site collection metadata
│   └── main/                   # Site
│       ├── _site.json          # Site metadata
│       └── Documents/          # Document library
│           ├── _library.json   # Library metadata
│           └── file.docx       # Actual file
```

## Supported Endpoints

### Sites
- `GET /v1.0/sites` - List site collections
- `GET /v1.0/sites/{id}` - Get site by ID
- `GET /v1.0/sites/{id}/sites` - Get subsites

### Lists
- `GET /v1.0/sites/{id}/lists` - List all lists
- `GET /v1.0/sites/{id}/lists/{listId}` - Get list
- `GET /v1.0/sites/{id}/lists/{listId}/items` - Get items
- `POST /v1.0/sites/{id}/lists/{listId}/items` - Create item
- `PATCH /v1.0/sites/{id}/lists/{listId}/items/{itemId}` - Update
- `DELETE /v1.0/sites/{id}/lists/{listId}/items/{itemId}` - Delete

### Drives
- `GET /v1.0/sites/{id}/drives` - List drives
- `GET /v1.0/drives/{id}/root/children` - List root contents
- `GET /v1.0/drives/{id}/items/{itemId}` - Get item
- `GET /v1.0/drives/{id}/items/{itemId}/content` - Download
- `PUT /v1.0/drives/{id}/items/{itemId}/content` - Upload
- `DELETE /v1.0/drives/{id}/items/{itemId}` - Delete

## License

MIT
```

**Step 3: Update package.json metadata**

Ensure `package.json` has:
```json
{
  "name": "mock-sp-server",
  "version": "1.0.0",
  "description": "Mock SharePoint server for testing and development",
  "keywords": ["sharepoint", "mock", "testing", "microsoft-graph"],
  "author": "",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/imnotwallace/mock-SP-server.git"
  }
}
```

**Step 4: Build and verify**

```bash
npm run build
npm run test:run
```

**Step 5: Commit**

```bash
git add -A && git commit -m "docs: add README and finalize package metadata"
```

**Step 6: Push all changes**

```bash
git push
```

---

## Summary

This implementation plan covers:

1. **Project setup** - TypeScript, dependencies, build config
2. **Configuration** - Loading, defaults, CLI overrides
3. **Utilities** - ID generation, logging
4. **Database** - SQLite schema and operations
5. **Filesystem** - Directory scanning and file operations
6. **Server** - Express setup, middleware
7. **Routes** - Sites, Lists, Drives with full CRUD
8. **Auth** - None, static token, mock OAuth
9. **CLI** - Commands and options
10. **Documentation** - README, package metadata

Total: 13 tasks with ~80 bite-sized steps following TDD.
