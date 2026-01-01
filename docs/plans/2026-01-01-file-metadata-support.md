# File-Level Metadata Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add file-level metadata support that mirrors SharePoint's column/field architecture, enabling custom properties, user info, and rich Graph API responses.

**Architecture:** Extend `_library.json` to define columns (schema), add `_files.json` per folder for file metadata values, load metadata during filesystem scan into `field_values` table, and enhance API responses to include `file`, `createdBy`, `lastModifiedBy`, `parentReference`, and `fields` objects.

**Tech Stack:** TypeScript, Express.js, better-sqlite3, Vitest

---

## Task 1: MIME Type Utility

**Files:**
- Create: `src/utils/mime.ts`
- Test: `tests/utils/mime.test.ts`

**Step 1: Write the failing test**

Create file `tests/utils/mime.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { getMimeType } from '../../src/utils/mime.js';

describe('getMimeType', () => {
  it('returns correct MIME type for common extensions', () => {
    expect(getMimeType('document.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(getMimeType('spreadsheet.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(getMimeType('presentation.pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(getMimeType('image.png')).toBe('image/png');
    expect(getMimeType('image.jpg')).toBe('image/jpeg');
    expect(getMimeType('data.json')).toBe('application/json');
    expect(getMimeType('page.html')).toBe('text/html');
    expect(getMimeType('style.css')).toBe('text/css');
    expect(getMimeType('script.js')).toBe('application/javascript');
    expect(getMimeType('readme.txt')).toBe('text/plain');
    expect(getMimeType('document.pdf')).toBe('application/pdf');
  });

  it('returns octet-stream for unknown extensions', () => {
    expect(getMimeType('file.xyz')).toBe('application/octet-stream');
    expect(getMimeType('noextension')).toBe('application/octet-stream');
  });

  it('handles uppercase extensions', () => {
    expect(getMimeType('IMAGE.PNG')).toBe('image/png');
    expect(getMimeType('DOC.DOCX')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- tests/utils/mime.test.ts --no-file-parallelism
```
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create file `src/utils/mime.ts`:
```typescript
const MIME_TYPES: Record<string, string> = {
  // Microsoft Office
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',

  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',

  // Documents
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.rtf': 'application/rtf',
  '.csv': 'text/csv',
  '.md': 'text/markdown',

  // Web
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',

  // Archives
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',

  // Media
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

/**
 * Get MIME type from filename based on extension
 */
export function getMimeType(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) {
    return 'application/octet-stream';
  }

  const ext = filename.slice(lastDot).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}
```

**Step 4: Export from utils index**

Update `src/utils/index.ts` to add:
```typescript
export { getMimeType } from './mime.js';
```

**Step 5: Run test to verify it passes**

Run:
```bash
npm run test:run -- tests/utils/mime.test.ts --no-file-parallelism
```
Expected: PASS

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add MIME type utility"
```

---

## Task 2: File Metadata Types

**Files:**
- Create: `src/types/metadata.ts`
- Modify: `src/services/filesystem.ts` (import types)

**Step 1: Create metadata types**

Create file `src/types/metadata.ts`:
```typescript
/**
 * Column definition in a library (schema)
 */
export interface ColumnDefinition {
  name: string;
  type: 'text' | 'number' | 'boolean' | 'dateTime' | 'choice' | 'user';
  required?: boolean;
  choices?: string[];  // For choice type
  description?: string;
}

/**
 * User identity for createdBy/lastModifiedBy
 */
export interface UserIdentity {
  displayName: string;
  email?: string;
  id?: string;
}

/**
 * File metadata from _files.json
 */
export interface FileMetadata {
  createdBy?: UserIdentity;
  lastModifiedBy?: UserIdentity;
  fields?: Record<string, any>;
}

/**
 * Extended library metadata with columns
 */
export interface LibraryMetadata {
  displayName?: string;
  description?: string;
  columns?: ColumnDefinition[];
}

/**
 * Site metadata
 */
export interface SiteMetadata {
  displayName?: string;
  description?: string;
}

/**
 * Files metadata map (filename -> metadata)
 */
export type FilesMetadataMap = Record<string, FileMetadata>;

/**
 * Graph API file object
 */
export interface GraphFileObject {
  mimeType: string;
  hashes?: {
    quickXorHash?: string;
    sha1Hash?: string;
    sha256Hash?: string;
  };
}

/**
 * Graph API identity set
 */
export interface GraphIdentitySet {
  user?: {
    displayName?: string;
    email?: string;
    id?: string;
  };
}

/**
 * Graph API parent reference
 */
export interface GraphParentReference {
  driveId: string;
  driveType: string;
  id?: string;
  path?: string;
}

/**
 * Enhanced item with Graph API fields
 */
export interface EnhancedDriveItem {
  id: string;
  name: string;
  size?: number;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  webUrl?: string;
  file?: GraphFileObject;
  folder?: { childCount: number };
  createdBy?: GraphIdentitySet;
  lastModifiedBy?: GraphIdentitySet;
  parentReference?: GraphParentReference;
  fields?: Record<string, any>;
}
```

**Step 2: Create types index**

Create file `src/types/index.ts`:
```typescript
export * from './metadata.js';
```

**Step 3: Run build to verify types compile**

Run:
```bash
npm run build
```
Expected: SUCCESS

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add file metadata types"
```

---

## Task 3: Extend FilesystemService to Load File Metadata

**Files:**
- Modify: `src/services/filesystem.ts`
- Modify: `tests/services/filesystem.test.ts`

**Step 1: Write the failing test**

Add to `tests/services/filesystem.test.ts`:
```typescript
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
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- tests/services/filesystem.test.ts --no-file-parallelism
```
Expected: FAIL

**Step 3: Implement file metadata loading**

Update `src/services/filesystem.ts`:

Replace the interface definitions at the top:
```typescript
import * as fs from 'fs';
import * as path from 'path';
import { Database, ItemRecord } from './database.js';
import { pathToId } from '../utils/index.js';
import {
  SiteMetadata,
  LibraryMetadata,
  FilesMetadataMap,
  FileMetadata
} from '../types/index.js';
```

Add new method to load files metadata after `loadLibraryMetadata`:
```typescript
  private loadFilesMetadata(folderPath: string): FilesMetadataMap {
    const metadataPath = path.join(folderPath, '_files.json');
    if (fs.existsSync(metadataPath)) {
      try {
        const content = fs.readFileSync(metadataPath, 'utf-8');
        return JSON.parse(content);
      } catch (error) {
        // Silently ignore malformed metadata files
      }
    }
    return {};
  }

  private applyFileMetadata(fileId: string, metadata: FileMetadata): void {
    if (metadata.createdBy) {
      if (metadata.createdBy.displayName) {
        this.db.setFieldValue(fileId, 'createdBy.displayName', metadata.createdBy.displayName);
      }
      if (metadata.createdBy.email) {
        this.db.setFieldValue(fileId, 'createdBy.email', metadata.createdBy.email);
      }
      if (metadata.createdBy.id) {
        this.db.setFieldValue(fileId, 'createdBy.id', metadata.createdBy.id);
      }
    }

    if (metadata.lastModifiedBy) {
      if (metadata.lastModifiedBy.displayName) {
        this.db.setFieldValue(fileId, 'lastModifiedBy.displayName', metadata.lastModifiedBy.displayName);
      }
      if (metadata.lastModifiedBy.email) {
        this.db.setFieldValue(fileId, 'lastModifiedBy.email', metadata.lastModifiedBy.email);
      }
      if (metadata.lastModifiedBy.id) {
        this.db.setFieldValue(fileId, 'lastModifiedBy.id', metadata.lastModifiedBy.id);
      }
    }

    if (metadata.fields) {
      for (const [fieldName, fieldValue] of Object.entries(metadata.fields)) {
        const valueStr = typeof fieldValue === 'string' ? fieldValue : JSON.stringify(fieldValue);
        this.db.setFieldValue(fileId, `fields.${fieldName}`, valueStr);
      }
    }
  }
```

Update `loadLibraryMetadata` to store columns:
```typescript
  private loadLibraryMetadata(libraryDir: string, libraryId: string): void {
    const metadataPath = path.join(libraryDir, '_library.json');
    if (fs.existsSync(metadataPath)) {
      try {
        const content = fs.readFileSync(metadataPath, 'utf-8');
        const metadata: LibraryMetadata = JSON.parse(content);

        if (metadata.displayName) {
          this.db.setFieldValue(libraryId, 'displayName', metadata.displayName);
        }
        if (metadata.description) {
          this.db.setFieldValue(libraryId, 'description', metadata.description);
        }
        if (metadata.columns) {
          this.db.setFieldValue(libraryId, 'columns', JSON.stringify(metadata.columns));
        }
      } catch (error) {
        // Silently ignore malformed metadata files
      }
    }
  }
```

Update `scanDirectory` to load and apply file metadata. In the file handling section (inside `else if (entry.isFile() && level >= 3)`), after `this.db.upsertItem(item);` add:
```typescript
        // Apply file metadata if available
        const filesMetadata = this.loadFilesMetadata(dirPath);
        if (filesMetadata[entry.name]) {
          this.applyFileMetadata(id, filesMetadata[entry.name]);
        }
```

**Step 4: Run test to verify it passes**

Run:
```bash
npm run test:run -- tests/services/filesystem.test.ts --no-file-parallelism
```
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: load file metadata from _files.json"
```

---

## Task 4: Enhance Drive Items Response

**Files:**
- Modify: `src/routes/drives.ts`
- Modify: `tests/routes/drives.test.ts`

**Step 1: Write the failing test**

Add to `tests/routes/drives.test.ts` (add imports and update setup as needed):
```typescript
  it('returns enhanced file metadata with file object', async () => {
    // First scan to populate database
    fsService.scan();

    // Get a file's ID
    const files = db.getItemsByType('file');
    expect(files.length).toBeGreaterThan(0);
    const fileId = files[0].id;
    const driveId = files[0].parentId;

    const response = await request(app)
      .get(`/v1.0/drives/${driveId}/items/${fileId}`)
      .expect(200);

    expect(response.body.file).toBeDefined();
    expect(response.body.file.mimeType).toBe('text/plain');
    expect(response.body.createdDateTime).toBeDefined();
    expect(response.body.lastModifiedDateTime).toBeDefined();
  });

  it('returns fields when $expand=fields is used', async () => {
    // Create metadata
    const filesMetaPath = path.join(testDir, 'data/contoso/main/Documents/_files.json');
    fs.writeFileSync(filesMetaPath, JSON.stringify({
      'test.txt': {
        fields: { Department: 'Sales', Priority: 'High' }
      }
    }));

    fsService.scan();

    const files = db.getItemsByType('file');
    const fileId = files[0].id;
    const driveId = files[0].parentId;

    const response = await request(app)
      .get(`/v1.0/drives/${driveId}/items/${fileId}?$expand=fields`)
      .expect(200);

    expect(response.body.fields).toBeDefined();
    expect(response.body.fields.Department).toBe('Sales');
    expect(response.body.fields.Priority).toBe('High');
  });
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- tests/routes/drives.test.ts --no-file-parallelism
```
Expected: FAIL

**Step 3: Implement enhanced response**

Update `src/routes/drives.ts`:

Add imports at top:
```typescript
import { getMimeType } from '../utils/index.js';
import { EnhancedDriveItem, GraphIdentitySet } from '../types/index.js';
```

Add helper function after imports:
```typescript
/**
 * Build enhanced drive item with Graph API fields
 */
function buildEnhancedItem(
  item: any,
  db: any,
  serverHost: string,
  expand?: string[]
): EnhancedDriveItem {
  const enhanced: EnhancedDriveItem = {
    id: item.id,
    name: item.name,
    createdDateTime: item.createdAt,
    lastModifiedDateTime: item.modifiedAt,
  };

  if (item.size !== undefined) {
    enhanced.size = item.size;
  }

  // Add file object for files
  if (item.type === 'file') {
    enhanced.file = {
      mimeType: getMimeType(item.name)
    };
    enhanced.webUrl = `${serverHost}/${item.path}`;
  }

  // Add folder object for folders
  if (item.type === 'folder') {
    const children = db.getItemsByParent(item.id);
    enhanced.folder = { childCount: children.length };
  }

  // Get field values
  const fieldValues = db.getFieldValues(item.id);

  // Build createdBy if available
  const createdByName = fieldValues.find((f: any) => f.fieldName === 'createdBy.displayName');
  const createdByEmail = fieldValues.find((f: any) => f.fieldName === 'createdBy.email');
  if (createdByName || createdByEmail) {
    enhanced.createdBy = {
      user: {
        displayName: createdByName?.fieldValue,
        email: createdByEmail?.fieldValue
      }
    };
  }

  // Build lastModifiedBy if available
  const modifiedByName = fieldValues.find((f: any) => f.fieldName === 'lastModifiedBy.displayName');
  const modifiedByEmail = fieldValues.find((f: any) => f.fieldName === 'lastModifiedBy.email');
  if (modifiedByName || modifiedByEmail) {
    enhanced.lastModifiedBy = {
      user: {
        displayName: modifiedByName?.fieldValue,
        email: modifiedByEmail?.fieldValue
      }
    };
  }

  // Add parentReference
  if (item.parentId) {
    const parent = db.getItemById(item.parentId);
    if (parent) {
      // Find the drive (library) this item belongs to
      let driveId = item.parentId;
      let current = parent;
      while (current && current.type !== 'library') {
        driveId = current.parentId;
        current = current.parentId ? db.getItemById(current.parentId) : null;
      }

      enhanced.parentReference = {
        driveId: driveId || item.parentId,
        driveType: 'documentLibrary',
        id: item.parentId,
        path: `/drives/${driveId}/root:/${item.path.split('/').slice(-2, -1).join('/')}`
      };
    }
  }

  // Add fields if $expand=fields
  if (expand?.includes('fields')) {
    const fields: Record<string, any> = {};
    for (const fv of fieldValues) {
      if (fv.fieldName.startsWith('fields.')) {
        const fieldName = fv.fieldName.slice(7); // Remove 'fields.' prefix
        try {
          fields[fieldName] = JSON.parse(fv.fieldValue);
        } catch {
          fields[fieldName] = fv.fieldValue;
        }
      }
    }
    if (Object.keys(fields).length > 0) {
      enhanced.fields = fields;
    }
  }

  return enhanced;
}
```

Update the `GET /:driveId/items/:itemId` route to use enhanced response:
```typescript
  // GET /v1.0/drives/:driveId/items/:itemId - Get item by ID
  router.get('/:driveId/items/:itemId', (req: Request, res: Response, next: NextFunction) => {
    const { driveId, itemId } = req.params;
    const odata = (req as any).odata as ODataQuery;

    // Verify drive exists
    const drive = db.getItemById(driveId);
    if (!drive || drive.type !== 'library') {
      return next(GraphError.notFound(`Drive with ID '${driveId}' not found`));
    }

    // Get the item
    const item = db.getItemById(itemId);
    if (!item) {
      return next(GraphError.notFound(`Item with ID '${itemId}' not found`));
    }

    // Build enhanced response
    const serverHost = `${req.protocol}://${req.get('host')}`;
    const enhanced = buildEnhancedItem(item, db, serverHost, odata.$expand);

    res.json(enhanced);
  });
```

Also update `GET /:driveId/root/children` and `GET /:driveId/items/:itemId/children` to use enhanced items:
```typescript
  // GET /v1.0/drives/:driveId/root/children - List root folder contents
  router.get('/:driveId/root/children', (req: Request, res: Response, next: NextFunction) => {
    const { driveId } = req.params;
    const odata = (req as any).odata as ODataQuery;

    // Verify drive exists
    const drive = db.getItemById(driveId);
    if (!drive || drive.type !== 'library') {
      return next(GraphError.notFound(`Drive with ID '${driveId}' not found`));
    }

    // Get children of the drive (root level items)
    let children = db.getItemsByParent(driveId);

    // Apply pagination
    children = applyPagination(children, odata.$top, odata.$skip);

    // Build enhanced items
    const serverHost = `${req.protocol}://${req.get('host')}`;
    let value = children.map(item => {
      const enhanced = buildEnhancedItem(item, db, serverHost, odata.$expand);
      return applySelect(enhanced, odata.$select);
    });

    const response = formatODataResponse(
      value,
      'https://graph.microsoft.com/v1.0/$metadata#driveItems'
    );

    res.json(response);
  });
```

**Step 4: Run test to verify it passes**

Run:
```bash
npm run test:run -- tests/routes/drives.test.ts --no-file-parallelism
```
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: enhance drive items with Graph API metadata"
```

---

## Task 5: Update CLI to Generate Sample Metadata

**Files:**
- Modify: `src/bin/cli.ts`
- Modify: `tests/cli.test.ts`

**Step 1: Write the failing test**

Add to `tests/cli.test.ts`:
```typescript
  it('should create _files.json with sample metadata', async () => {
    const initDir = path.join(testDir, 'init-meta-test');
    await execAsync(`node ${cliPath} init "${initDir}"`);

    const filesJsonPath = path.join(initDir, 'contoso/main/Documents/_files.json');
    expect(fs.existsSync(filesJsonPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filesJsonPath, 'utf-8'));
    expect(content['Welcome.txt']).toBeDefined();
    expect(content['Welcome.txt'].createdBy).toBeDefined();
    expect(content['Welcome.txt'].createdBy.displayName).toBeDefined();
  });

  it('should create _library.json with columns', async () => {
    const initDir = path.join(testDir, 'init-cols-test');
    await execAsync(`node ${cliPath} init "${initDir}"`);

    const libraryJsonPath = path.join(initDir, 'contoso/main/Documents/_library.json');
    expect(fs.existsSync(libraryJsonPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(libraryJsonPath, 'utf-8'));
    expect(content.columns).toBeDefined();
    expect(content.columns.length).toBeGreaterThan(0);
  });
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- tests/cli.test.ts --no-file-parallelism
```
Expected: FAIL

**Step 3: Update CLI init command**

In `src/bin/cli.ts`, update the init command to add enhanced metadata. Find the section that creates `_library.json` files and update it:

```typescript
  // Create _library.json metadata files with columns
  const libraries = [
    {
      path: 'contoso/main/Documents/_library.json',
      content: {
        displayName: 'Documents',
        description: 'Default document library',
        columns: [
          { name: 'Department', type: 'choice', choices: ['Sales', 'Marketing', 'Engineering', 'HR'] },
          { name: 'Status', type: 'choice', choices: ['Draft', 'Review', 'Final', 'Archived'] },
          { name: 'DueDate', type: 'dateTime' },
          { name: 'Confidential', type: 'boolean' }
        ]
      }
    },
    // ... other libraries
  ];
```

Add creation of `_files.json` after creating sample files:

```typescript
  // Create _files.json metadata for sample files
  const filesMetadata = [
    {
      path: 'contoso/main/Documents/_files.json',
      content: {
        'Welcome.txt': {
          createdBy: { displayName: 'System Admin', email: 'admin@contoso.com' },
          lastModifiedBy: { displayName: 'System Admin', email: 'admin@contoso.com' },
          fields: {
            Department: 'Engineering',
            Status: 'Final',
            Confidential: false
          }
        }
      }
    }
  ];

  for (const meta of filesMetadata) {
    const metaPath = path.join(baseDir, meta.path);
    fs.writeFileSync(metaPath, JSON.stringify(meta.content, null, 2));
    console.log(`Created: ${meta.path}`);
  }
```

**Step 4: Run test to verify it passes**

Run:
```bash
npm run test:run -- tests/cli.test.ts --no-file-parallelism
```
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add sample file metadata to CLI init"
```

---

## Task 6: Run All Tests and Final Verification

**Step 1: Run all tests**

```bash
npm run test:run -- --no-file-parallelism
```
Expected: All tests pass

**Step 2: Build project**

```bash
npm run build
```
Expected: SUCCESS

**Step 3: Manual verification**

```bash
# Create a fresh test directory
rm -rf ./test-verify
npm run dev -- init ./test-verify

# Verify files were created
cat ./test-verify/contoso/main/Documents/_files.json
cat ./test-verify/contoso/main/Documents/_library.json

# Start server and test endpoint
npm run dev -- --root ./test-verify &
sleep 2
curl http://localhost:5001/v1.0/sites
curl "http://localhost:5001/v1.0/drives?$expand=fields"
```

**Step 4: Final commit and push**

```bash
git add -A && git commit -m "feat: complete file metadata support implementation"
git push
```

---

## Summary

This implementation adds:

1. **MIME type utility** - Derives `file.mimeType` from extensions
2. **Metadata types** - TypeScript interfaces for all metadata structures
3. **File metadata loading** - `_files.json` parsed during scan, values stored in `field_values`
4. **Library columns** - `_library.json` extended with `columns` array
5. **Enhanced API responses** - `file`, `createdBy`, `lastModifiedBy`, `parentReference`, `fields`
6. **`$expand=fields` support** - Returns custom field values when requested
7. **CLI sample data** - `init` command creates example metadata files
