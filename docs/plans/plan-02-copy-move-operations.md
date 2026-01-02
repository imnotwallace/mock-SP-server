# Plan 02: Copy/Move Operations

## Overview

Implement copy and move operations for drive items. Copy is asynchronous with progress monitoring; move is synchronous via PATCH request.

## References

- [driveItem: copy](https://learn.microsoft.com/en-us/graph/api/driveitem-copy?view=graph-rest-1.0)
- [driveItem: move](https://learn.microsoft.com/en-us/graph/api/driveitem-move?view=graph-rest-1.0)

## Current State

- File upload/download/delete are implemented
- No copy or move operations exist
- Database tracks items with parent relationships

## API Specifications

### Copy Operation

**Endpoint:** `POST /drives/{driveId}/items/{itemId}/copy`

**Request Body:**
```json
{
  "parentReference": {
    "driveId": "target-drive-id",
    "id": "target-folder-id"
  },
  "name": "new-name.docx"
}
```

**Query Parameters:**
- `@microsoft.graph.conflictBehavior`: `fail` | `replace` | `rename`

**Response:** `202 Accepted` with `Location` header pointing to monitor URL

**Monitor Response:**
```json
{
  "status": "inProgress",
  "percentageComplete": 45.5,
  "resourceId": "new-item-id"
}
```

When complete:
```json
{
  "status": "completed",
  "resourceId": "new-item-id"
}
```

### Move Operation

**Endpoint:** `PATCH /drives/{driveId}/items/{itemId}`

**Request Body:**
```json
{
  "parentReference": {
    "id": "new-parent-folder-id"
  },
  "name": "optional-new-name.docx"
}
```

**Response:** `200 OK` with updated driveItem

## Implementation Steps

### Step 1: Add Copy Operation Table

Add to `src/services/database.ts`:

```sql
CREATE TABLE IF NOT EXISTS copy_operations (
  id TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL,
  target_drive_id TEXT NOT NULL,
  target_folder_id TEXT NOT NULL,
  new_name TEXT,
  status TEXT NOT NULL DEFAULT 'inProgress',
  percentage_complete REAL DEFAULT 0,
  resource_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
```

### Step 2: Create Copy Handler (`src/routes/drives.ts`)

```typescript
// POST /drives/:driveId/items/:itemId/copy
router.post('/:driveId/items/:itemId/copy', async (req, res) => {
  const { driveId, itemId } = req.params;
  const { parentReference, name } = req.body;
  const conflictBehavior = req.query['@microsoft.graph.conflictBehavior'] || 'fail';

  // Validate source exists
  const sourceItem = await db.getItem(itemId);
  if (!sourceItem) {
    throw GraphError.notFound('Source item not found');
  }

  // Validate target folder exists
  const targetFolder = await db.getItem(parentReference.id);
  if (!targetFolder || targetFolder.type !== 'folder') {
    throw GraphError.badRequest('Target must be a folder');
  }

  // Check for conflicts
  const newName = name || sourceItem.name;
  const existingItem = await db.getItemByNameInFolder(parentReference.id, newName);

  if (existingItem) {
    if (conflictBehavior === 'fail') {
      throw GraphError.conflict('Item with this name already exists');
    } else if (conflictBehavior === 'rename') {
      // Generate unique name: "filename (1).ext"
      newName = generateUniqueName(newName, parentReference.id);
    }
    // 'replace' will overwrite in the async operation
  }

  // Create copy operation record
  const operationId = generateId();
  await db.createCopyOperation({
    id: operationId,
    sourceItemId: itemId,
    targetDriveId: parentReference.driveId || driveId,
    targetFolderId: parentReference.id,
    newName,
    status: 'inProgress'
  });

  // Start async copy (in real impl, would be background job)
  performCopyAsync(operationId, sourceItem, targetFolder, newName, conflictBehavior);

  // Return 202 with monitor URL
  res.status(202)
    .header('Location', `/v1.0/drives/${driveId}/operations/${operationId}`)
    .end();
});
```

### Step 3: Implement Async Copy Logic

```typescript
async function performCopyAsync(
  operationId: string,
  sourceItem: DbItem,
  targetFolder: DbItem,
  newName: string,
  conflictBehavior: string
): Promise<void> {
  try {
    if (sourceItem.type === 'file') {
      // Copy single file
      const sourceContent = await fsService.readFile(sourceItem.path);
      const targetPath = path.join(targetFolder.path, newName);
      await fsService.writeFile(targetPath, sourceContent);

      const newItemId = pathToId(targetPath);
      await db.createItem({
        id: newItemId,
        path: targetPath,
        type: 'file',
        parentId: targetFolder.id,
        name: newName,
        size: sourceItem.size
      });

      await db.updateCopyOperation(operationId, {
        status: 'completed',
        percentageComplete: 100,
        resourceId: newItemId
      });
    } else if (sourceItem.type === 'folder') {
      // Recursively copy folder and contents
      await copyFolderRecursive(operationId, sourceItem, targetFolder, newName);
    }
  } catch (error) {
    await db.updateCopyOperation(operationId, {
      status: 'failed',
      errorMessage: error.message
    });
  }
}

async function copyFolderRecursive(
  operationId: string,
  sourceFolder: DbItem,
  targetParent: DbItem,
  newName: string
): Promise<void> {
  // Count total items for progress
  const allItems = await db.getDescendants(sourceFolder.id);
  const totalItems = allItems.length + 1;
  let copiedItems = 0;

  // Create target folder
  const targetPath = path.join(targetParent.path, newName);
  await fsService.createDirectory(targetPath);

  const newFolderId = pathToId(targetPath);
  await db.createItem({
    id: newFolderId,
    path: targetPath,
    type: 'folder',
    parentId: targetParent.id,
    name: newName
  });

  copiedItems++;
  await updateProgress(operationId, copiedItems, totalItems);

  // Copy children recursively
  const children = await db.getChildren(sourceFolder.id);
  for (const child of children) {
    if (child.type === 'folder') {
      await copyFolderRecursive(operationId, child, { id: newFolderId, path: targetPath }, child.name);
    } else {
      const sourceContent = await fsService.readFile(child.path);
      const childTargetPath = path.join(targetPath, child.name);
      await fsService.writeFile(childTargetPath, sourceContent);

      await db.createItem({
        id: pathToId(childTargetPath),
        path: childTargetPath,
        type: 'file',
        parentId: newFolderId,
        name: child.name,
        size: child.size
      });
    }
    copiedItems++;
    await updateProgress(operationId, copiedItems, totalItems);
  }

  await db.updateCopyOperation(operationId, {
    status: 'completed',
    percentageComplete: 100,
    resourceId: newFolderId
  });
}
```

### Step 4: Add Operation Monitor Endpoint

```typescript
// GET /drives/:driveId/operations/:operationId
router.get('/:driveId/operations/:operationId', async (req, res) => {
  const { operationId } = req.params;

  const operation = await db.getCopyOperation(operationId);
  if (!operation) {
    throw GraphError.notFound('Operation not found');
  }

  if (operation.status === 'completed') {
    res.json({
      status: 'completed',
      resourceId: operation.resourceId
    });
  } else if (operation.status === 'failed') {
    res.status(500).json({
      status: 'failed',
      error: {
        code: 'generalException',
        message: operation.errorMessage
      }
    });
  } else {
    res.json({
      status: 'inProgress',
      percentageComplete: operation.percentageComplete
    });
  }
});
```

### Step 5: Implement Move Operation

```typescript
// PATCH /drives/:driveId/items/:itemId
router.patch('/:driveId/items/:itemId', async (req, res) => {
  const { driveId, itemId } = req.params;
  const { parentReference, name } = req.body;

  const item = await db.getItem(itemId);
  if (!item) {
    throw GraphError.notFound('Item not found');
  }

  // If parentReference is provided, this is a move
  if (parentReference?.id) {
    const targetFolder = await db.getItem(parentReference.id);
    if (!targetFolder || targetFolder.type !== 'folder') {
      throw GraphError.badRequest('Target must be a folder');
    }

    // Cannot move between drives in this mock
    if (parentReference.driveId && parentReference.driveId !== driveId) {
      throw GraphError.badRequest('Cannot move items between drives');
    }

    const newName = name || item.name;
    const oldPath = item.path;
    const newPath = path.join(targetFolder.path, newName);

    // Move file on filesystem
    await fsService.moveFile(oldPath, newPath);

    // Update database
    await db.updateItem(itemId, {
      path: newPath,
      parentId: targetFolder.id,
      name: newName,
      modifiedAt: new Date().toISOString()
    });

    // If folder, update all descendant paths
    if (item.type === 'folder') {
      await db.updateDescendantPaths(itemId, oldPath, newPath);
    }
  } else if (name && name !== item.name) {
    // Just a rename
    const parentPath = path.dirname(item.path);
    const newPath = path.join(parentPath, name);

    await fsService.moveFile(item.path, newPath);
    await db.updateItem(itemId, {
      path: newPath,
      name: name,
      modifiedAt: new Date().toISOString()
    });

    if (item.type === 'folder') {
      await db.updateDescendantPaths(itemId, item.path, newPath);
    }
  }

  const updatedItem = await db.getItem(itemId);
  res.json(formatDriveItem(updatedItem));
});
```

### Step 6: Add Filesystem Move Support

Update `src/services/filesystem.ts`:

```typescript
async moveFile(oldPath: string, newPath: string): Promise<void> {
  const fullOldPath = this.resolvePath(oldPath);
  const fullNewPath = this.resolvePath(newPath);

  // Ensure target directory exists
  await fs.mkdir(path.dirname(fullNewPath), { recursive: true });

  // Move file/folder
  await fs.rename(fullOldPath, fullNewPath);
}

async createDirectory(relativePath: string): Promise<void> {
  const fullPath = this.resolvePath(relativePath);
  await fs.mkdir(fullPath, { recursive: true });
}
```

## Test Cases

```typescript
describe('Copy operations', () => {
  test('POST /drives/{id}/items/{id}/copy returns 202 with Location', async () => {
    const response = await request(app)
      .post(`/v1.0/drives/${driveId}/items/${fileId}/copy`)
      .send({
        parentReference: { id: targetFolderId },
        name: 'copied-file.txt'
      });

    expect(response.status).toBe(202);
    expect(response.headers.location).toMatch(/\/operations\//);
  });

  test('Operation monitor returns progress', async () => {
    // ... trigger copy, then poll
    const response = await request(app)
      .get(operationUrl);

    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('percentageComplete');
  });

  test('Copy with conflictBehavior=rename generates unique name', async () => {
    // Create original, then copy with same name
    const response = await request(app)
      .post(`/v1.0/drives/${driveId}/items/${fileId}/copy?@microsoft.graph.conflictBehavior=rename`)
      .send({ parentReference: { id: sameFolderId } });

    // ... verify new item has modified name
  });
});

describe('Move operations', () => {
  test('PATCH with parentReference moves item', async () => {
    const response = await request(app)
      .patch(`/v1.0/drives/${driveId}/items/${fileId}`)
      .send({ parentReference: { id: newFolderId } });

    expect(response.status).toBe(200);
    expect(response.body.parentReference.id).toBe(newFolderId);
  });

  test('PATCH with name renames item', async () => {
    const response = await request(app)
      .patch(`/v1.0/drives/${driveId}/items/${fileId}`)
      .send({ name: 'new-name.txt' });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('new-name.txt');
  });

  test('Move folder updates all descendant paths', async () => {
    // Create folder with children, move it, verify children paths
  });
});
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/services/database.ts` | Modify - Add copy_operations table and methods |
| `src/services/filesystem.ts` | Modify - Add moveFile, createDirectory |
| `src/routes/drives.ts` | Modify - Add copy, move, operations endpoints |
| `tests/routes/drives.test.ts` | Modify - Add copy/move tests |

## Limitations

- Cross-drive copy/move not supported (real Graph API supports it)
- No version history preservation on copy (can add via `includeAllVersionHistory`)
- Synchronous copy for small files (real API always async)
- No `childrenOnly` parameter support

## Success Criteria

1. Copy returns 202 Accepted with Location header
2. Operation monitor shows progress and completion
3. Move via PATCH updates item location
4. Rename via PATCH updates item name
5. Folder operations cascade to descendants
6. Conflict behavior (fail/replace/rename) works correctly
