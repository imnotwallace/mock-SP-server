# Plan 08: Large File Upload Sessions

## Overview

Implement resumable upload sessions for large files (>4MB). This allows clients to upload files in chunks with the ability to resume interrupted uploads.

## References

- [driveItem: createUploadSession](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0)
- [Upload large files](https://learn.microsoft.com/en-us/graph/sdks/large-file-upload)
- [Resumable file upload](https://learn.microsoft.com/en-us/onedrive/developer/rest-api/api/driveitem_createuploadsession?view=odsp-graph-online)

## Current State

- Simple PUT upload works for small files
- No chunked upload support
- No resumable upload capability

## API Specifications

### Create Upload Session

**Endpoint:** `POST /drives/{driveId}/items/{itemId}:/filename:/createUploadSession`

**Request Body:**
```json
{
  "item": {
    "@microsoft.graph.conflictBehavior": "rename",
    "name": "largefile.zip"
  }
}
```

**Response:**
```json
{
  "uploadUrl": "https://api.example.com/upload/session/abc123...",
  "expirationDateTime": "2024-01-16T12:00:00Z",
  "nextExpectedRanges": ["0-"]
}
```

### Upload Bytes

**Endpoint:** `PUT {uploadUrl}` (from createUploadSession response)

**Headers:**
```
Content-Length: 327680
Content-Range: bytes 0-327679/1048576
```

**Response (in progress):**
```json
{
  "expirationDateTime": "2024-01-16T12:00:00Z",
  "nextExpectedRanges": ["327680-1048575"]
}
```

**Response (complete):**
```json
{
  "id": "new-item-id",
  "name": "largefile.zip",
  "size": 1048576,
  ...
}
```

### Get Upload Session Status

**Endpoint:** `GET {uploadUrl}`

**Response:**
```json
{
  "expirationDateTime": "2024-01-16T12:00:00Z",
  "nextExpectedRanges": ["327680-"]
}
```

### Cancel Upload Session

**Endpoint:** `DELETE {uploadUrl}`

**Response:** `204 No Content`

## Implementation Steps

### Step 1: Create Upload Sessions Table

Update `src/services/database.ts`:

```sql
CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  drive_id TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  expected_size INTEGER,
  uploaded_bytes INTEGER DEFAULT 0,
  temp_file_path TEXT NOT NULL,
  conflict_behavior TEXT DEFAULT 'fail',
  expiration_date_time TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_activity TEXT NOT NULL,
  chunks TEXT DEFAULT '[]'  -- JSON array of uploaded byte ranges
);

CREATE INDEX idx_upload_sessions_expiration ON upload_sessions(expiration_date_time);
```

### Step 2: Create Upload Session Service

Create `src/services/upload-session.ts`:

```typescript
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';

interface UploadSession {
  id: string;
  uploadUrl: string;
  expirationDateTime: string;
  nextExpectedRanges: string[];
}

interface ByteRange {
  start: number;
  end: number;
}

export class UploadSessionService {
  private readonly SESSION_DURATION_HOURS = 24;
  private readonly TEMP_DIR = '.uploads';

  constructor(
    private db: DatabaseService,
    private fsService: FilesystemService,
    private config: Config
  ) {}

  async createSession(
    driveId: string,
    parentId: string,
    fileName: string,
    expectedSize?: number,
    conflictBehavior: string = 'fail'
  ): Promise<UploadSession> {
    const sessionId = crypto.randomBytes(32).toString('base64url');
    const tempPath = path.join(this.TEMP_DIR, sessionId);
    const expiration = new Date(Date.now() + this.SESSION_DURATION_HOURS * 60 * 60 * 1000);

    // Create temp file
    await this.fsService.ensureDir(this.TEMP_DIR);
    await fs.writeFile(this.fsService.resolvePath(tempPath), Buffer.alloc(0));

    // Save session
    this.db.prepare(`
      INSERT INTO upload_sessions (
        id, drive_id, parent_id, file_name, expected_size,
        temp_file_path, conflict_behavior, expiration_date_time,
        created_at, last_activity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      driveId,
      parentId,
      fileName,
      expectedSize || null,
      tempPath,
      conflictBehavior,
      expiration.toISOString(),
      new Date().toISOString(),
      new Date().toISOString()
    );

    return {
      id: sessionId,
      uploadUrl: `${this.config.baseUrl}/upload/sessions/${sessionId}`,
      expirationDateTime: expiration.toISOString(),
      nextExpectedRanges: ['0-']
    };
  }

  async uploadBytes(
    sessionId: string,
    content: Buffer,
    contentRange: string
  ): Promise<{ session?: UploadSession; item?: DriveItem }> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw GraphError.notFound('Upload session not found or expired');
    }

    // Parse Content-Range header: "bytes 0-327679/1048576"
    const rangeMatch = contentRange.match(/bytes (\d+)-(\d+)\/(\d+|\*)/);
    if (!rangeMatch) {
      throw GraphError.badRequest('Invalid Content-Range header');
    }

    const rangeStart = parseInt(rangeMatch[1]);
    const rangeEnd = parseInt(rangeMatch[2]);
    const totalSize = rangeMatch[3] === '*' ? null : parseInt(rangeMatch[3]);

    // Validate range
    if (rangeEnd - rangeStart + 1 !== content.length) {
      throw GraphError.badRequest('Content-Range does not match content length');
    }

    // Validate chunk size is multiple of 320KB (except last chunk)
    const CHUNK_SIZE = 320 * 1024;
    if (content.length % CHUNK_SIZE !== 0 && totalSize && rangeEnd + 1 < totalSize) {
      throw GraphError.badRequest('Chunk size must be a multiple of 320 KiB');
    }

    // Write chunk to temp file
    const tempPath = this.fsService.resolvePath(session.temp_file_path);
    const handle = await fs.open(tempPath, 'r+');
    try {
      await handle.write(content, 0, content.length, rangeStart);
    } finally {
      await handle.close();
    }

    // Update session
    const chunks = JSON.parse(session.chunks);
    chunks.push({ start: rangeStart, end: rangeEnd });
    const uploadedBytes = this.calculateUploadedBytes(chunks);

    this.db.prepare(`
      UPDATE upload_sessions
      SET uploaded_bytes = ?, chunks = ?, last_activity = ?,
          expected_size = COALESCE(expected_size, ?)
      WHERE id = ?
    `).run(
      uploadedBytes,
      JSON.stringify(chunks),
      new Date().toISOString(),
      totalSize,
      sessionId
    );

    // Check if complete
    if (totalSize && uploadedBytes >= totalSize) {
      const item = await this.completeUpload(sessionId, session);
      return { item };
    }

    // Return session status
    const nextRanges = this.calculateNextExpectedRanges(chunks, totalSize);
    return {
      session: {
        id: sessionId,
        uploadUrl: `${this.config.baseUrl}/upload/sessions/${sessionId}`,
        expirationDateTime: session.expiration_date_time,
        nextExpectedRanges: nextRanges
      }
    };
  }

  async getSessionStatus(sessionId: string): Promise<UploadSession | null> {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const chunks = JSON.parse(session.chunks);
    const nextRanges = this.calculateNextExpectedRanges(chunks, session.expected_size);

    return {
      id: sessionId,
      uploadUrl: `${this.config.baseUrl}/upload/sessions/${sessionId}`,
      expirationDateTime: session.expiration_date_time,
      nextExpectedRanges: nextRanges
    };
  }

  async cancelSession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw GraphError.notFound('Upload session not found');
    }

    // Delete temp file
    try {
      await this.fsService.deleteFile(session.temp_file_path);
    } catch (error) {
      // Ignore if already deleted
    }

    // Remove from database
    this.db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(sessionId);
  }

  async cleanupExpiredSessions(): Promise<number> {
    const expired = this.db.prepare(`
      SELECT id, temp_file_path FROM upload_sessions
      WHERE expiration_date_time < datetime('now')
    `).all();

    for (const session of expired) {
      try {
        await this.fsService.deleteFile(session.temp_file_path);
      } catch (error) {
        // Ignore
      }
      this.db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(session.id);
    }

    return expired.length;
  }

  private getSession(sessionId: string): any {
    return this.db.prepare(`
      SELECT * FROM upload_sessions
      WHERE id = ? AND expiration_date_time > datetime('now')
    `).get(sessionId);
  }

  private async completeUpload(sessionId: string, session: any): Promise<DriveItem> {
    // Determine final path
    const parent = await this.db.getItem(session.parent_id);
    let finalPath = path.join(parent.path, session.file_name);

    // Handle conflict
    if (session.conflict_behavior === 'rename') {
      finalPath = await this.getUniquePath(finalPath);
    } else if (session.conflict_behavior === 'fail') {
      if (await this.fsService.exists(finalPath)) {
        throw GraphError.conflict('File already exists');
      }
    }
    // 'replace' just overwrites

    // Move temp file to final location
    await this.fsService.moveFile(session.temp_file_path, finalPath);

    // Create or update item in database
    const itemId = pathToId(finalPath);
    const stats = await fs.stat(this.fsService.resolvePath(finalPath));

    await this.db.upsertItem({
      id: itemId,
      path: finalPath,
      type: 'file',
      parentId: session.parent_id,
      name: path.basename(finalPath),
      size: stats.size,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString()
    });

    // Clean up session
    this.db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(sessionId);

    return this.db.getItem(itemId);
  }

  private calculateUploadedBytes(chunks: ByteRange[]): number {
    // Merge overlapping ranges and sum
    const sorted = [...chunks].sort((a, b) => a.start - b.start);
    const merged: ByteRange[] = [];

    for (const chunk of sorted) {
      if (merged.length === 0 || merged[merged.length - 1].end < chunk.start - 1) {
        merged.push({ ...chunk });
      } else {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, chunk.end);
      }
    }

    return merged.reduce((sum, r) => sum + (r.end - r.start + 1), 0);
  }

  private calculateNextExpectedRanges(chunks: ByteRange[], totalSize?: number): string[] {
    if (chunks.length === 0) {
      return ['0-'];
    }

    const sorted = [...chunks].sort((a, b) => a.start - b.start);
    const gaps: string[] = [];

    // Check for gap at start
    if (sorted[0].start > 0) {
      gaps.push(`0-${sorted[0].start - 1}`);
    }

    // Check for gaps between chunks
    for (let i = 0; i < sorted.length - 1; i++) {
      const gapStart = sorted[i].end + 1;
      const gapEnd = sorted[i + 1].start - 1;
      if (gapStart <= gapEnd) {
        gaps.push(`${gapStart}-${gapEnd}`);
      }
    }

    // Check for gap at end
    const lastEnd = sorted[sorted.length - 1].end;
    if (!totalSize || lastEnd < totalSize - 1) {
      gaps.push(`${lastEnd + 1}-`);
    }

    return gaps.length > 0 ? gaps : [];
  }

  private async getUniquePath(basePath: string): Promise<string> {
    const dir = path.dirname(basePath);
    const ext = path.extname(basePath);
    const name = path.basename(basePath, ext);

    let counter = 1;
    let newPath = basePath;

    while (await this.fsService.exists(newPath)) {
      newPath = path.join(dir, `${name} (${counter})${ext}`);
      counter++;
    }

    return newPath;
  }
}
```

### Step 3: Add Upload Session Routes

Create `src/routes/upload.ts`:

```typescript
import { Router } from 'express';
import * as express from 'express';

const router = Router();

// Use raw body parser for binary uploads
router.use(express.raw({
  type: '*/*',
  limit: '64mb'
}));

// PUT /upload/sessions/:sessionId
router.put('/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const contentRange = req.get('Content-Range');

  if (!contentRange) {
    throw GraphError.badRequest('Content-Range header is required');
  }

  const result = await uploadSessionService.uploadBytes(
    sessionId,
    req.body,
    contentRange
  );

  if (result.item) {
    // Upload complete
    res.status(201).json(formatDriveItem(result.item));
  } else {
    // More bytes expected
    res.status(202).json(result.session);
  }
});

// GET /upload/sessions/:sessionId
router.get('/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  const session = await uploadSessionService.getSessionStatus(sessionId);
  if (!session) {
    throw GraphError.notFound('Upload session not found or expired');
  }

  res.json(session);
});

// DELETE /upload/sessions/:sessionId
router.delete('/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  await uploadSessionService.cancelSession(sessionId);

  res.status(204).end();
});

export { router as uploadRouter };
```

### Step 4: Add createUploadSession Endpoint

Add to `src/routes/drives.ts`:

```typescript
// POST /drives/:driveId/items/:parentId:/:fileName:/createUploadSession
// Express pattern for OData path syntax
router.post('/:driveId/items/:parentId\\:/:fileName\\:/createUploadSession', async (req, res) => {
  const { driveId, parentId, fileName } = req.params;
  const { item } = req.body;

  const parent = await db.getItem(parentId);
  if (!parent) {
    throw GraphError.notFound('Parent folder not found');
  }

  const session = await uploadSessionService.createSession(
    driveId,
    parentId,
    fileName,
    item?.size,
    item?.['@microsoft.graph.conflictBehavior'] || 'fail'
  );

  res.status(200).json(session);
});

// Also support root path
// POST /drives/:driveId/root:/:path:/createUploadSession
router.post('/:driveId/root\\:/*', async (req, res, next) => {
  if (!req.path.endsWith('/createUploadSession')) {
    return next();
  }

  const { driveId } = req.params;
  const filePath = req.params[0].replace('/createUploadSession', '');
  const fileName = path.basename(filePath);
  const parentPath = path.dirname(filePath);

  // Find or create parent folders
  const parent = await ensureParentFolders(driveId, parentPath);

  const session = await uploadSessionService.createSession(
    driveId,
    parent.id,
    fileName,
    req.body.item?.size,
    req.body.item?.['@microsoft.graph.conflictBehavior'] || 'fail'
  );

  res.status(200).json(session);
});
```

### Step 5: Register Upload Routes

Update `src/server.ts`:

```typescript
import { uploadRouter } from './routes/upload';

// Register routes
app.use('/upload', uploadRouter);
```

### Step 6: Add Session Cleanup Job

```typescript
// In server.ts or separate scheduler
setInterval(async () => {
  const cleaned = await uploadSessionService.cleanupExpiredSessions();
  if (cleaned > 0) {
    logger.info(`Cleaned up ${cleaned} expired upload sessions`);
  }
}, 60 * 60 * 1000); // Every hour
```

## Test Cases

```typescript
describe('Large File Upload', () => {
  const CHUNK_SIZE = 320 * 1024; // 320 KB

  describe('POST createUploadSession', () => {
    test('creates upload session', async () => {
      const response = await request(app)
        .post(`/v1.0/drives/${driveId}/root:/largefile.zip:/createUploadSession`)
        .send({ item: { '@microsoft.graph.conflictBehavior': 'rename' } });

      expect(response.status).toBe(200);
      expect(response.body.uploadUrl).toBeDefined();
      expect(response.body.expirationDateTime).toBeDefined();
      expect(response.body.nextExpectedRanges).toEqual(['0-']);
    });
  });

  describe('PUT uploadUrl', () => {
    test('uploads single chunk', async () => {
      const session = await createSession();
      const chunk = Buffer.alloc(CHUNK_SIZE, 'x');

      const response = await request(app)
        .put(new URL(session.uploadUrl).pathname)
        .set('Content-Range', `bytes 0-${CHUNK_SIZE - 1}/${CHUNK_SIZE}`)
        .send(chunk);

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.size).toBe(CHUNK_SIZE);
    });

    test('uploads multiple chunks', async () => {
      const session = await createSession();
      const totalSize = CHUNK_SIZE * 3;

      // Upload chunk 1
      let response = await request(app)
        .put(new URL(session.uploadUrl).pathname)
        .set('Content-Range', `bytes 0-${CHUNK_SIZE - 1}/${totalSize}`)
        .send(Buffer.alloc(CHUNK_SIZE, 'a'));

      expect(response.status).toBe(202);
      expect(response.body.nextExpectedRanges).toContain(`${CHUNK_SIZE}-`);

      // Upload chunk 2
      response = await request(app)
        .put(new URL(session.uploadUrl).pathname)
        .set('Content-Range', `bytes ${CHUNK_SIZE}-${CHUNK_SIZE * 2 - 1}/${totalSize}`)
        .send(Buffer.alloc(CHUNK_SIZE, 'b'));

      expect(response.status).toBe(202);

      // Upload chunk 3 (final)
      response = await request(app)
        .put(new URL(session.uploadUrl).pathname)
        .set('Content-Range', `bytes ${CHUNK_SIZE * 2}-${totalSize - 1}/${totalSize}`)
        .send(Buffer.alloc(CHUNK_SIZE, 'c'));

      expect(response.status).toBe(201);
      expect(response.body.size).toBe(totalSize);
    });

    test('resumes interrupted upload', async () => {
      const session = await createSession();
      const totalSize = CHUNK_SIZE * 2;

      // Upload chunk 1
      await request(app)
        .put(new URL(session.uploadUrl).pathname)
        .set('Content-Range', `bytes 0-${CHUNK_SIZE - 1}/${totalSize}`)
        .send(Buffer.alloc(CHUNK_SIZE));

      // Check status
      const status = await request(app)
        .get(new URL(session.uploadUrl).pathname);

      expect(status.body.nextExpectedRanges).toContain(`${CHUNK_SIZE}-`);

      // Resume with chunk 2
      const response = await request(app)
        .put(new URL(session.uploadUrl).pathname)
        .set('Content-Range', `bytes ${CHUNK_SIZE}-${totalSize - 1}/${totalSize}`)
        .send(Buffer.alloc(CHUNK_SIZE));

      expect(response.status).toBe(201);
    });
  });

  describe('DELETE uploadUrl', () => {
    test('cancels upload session', async () => {
      const session = await createSession();

      const response = await request(app)
        .delete(new URL(session.uploadUrl).pathname);

      expect(response.status).toBe(204);

      // Session should be gone
      const check = await request(app)
        .get(new URL(session.uploadUrl).pathname);
      expect(check.status).toBe(404);
    });
  });
});
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/services/upload-session.ts` | Create - Upload session management |
| `src/services/database.ts` | Modify - Add upload_sessions table |
| `src/routes/upload.ts` | Create - Upload session endpoints |
| `src/routes/drives.ts` | Modify - Add createUploadSession |
| `src/server.ts` | Modify - Register routes, cleanup job |
| `tests/routes/upload.test.ts` | Create - Upload session tests |

## Limitations

- No encryption for temp files
- Simplified conflict handling
- No progress callbacks
- Single-server only (no distributed session storage)
- 64MB max per request (configurable)

## Success Criteria

1. createUploadSession returns upload URL
2. Sequential chunk uploads work
3. Out-of-order chunks accumulate correctly
4. Resume after interruption works
5. Complete upload creates the file item
6. Cancel removes session and temp file
7. Expired sessions are cleaned up
8. Chunk size validation (320KB multiples)
