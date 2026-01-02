# Plan 11: Thumbnails

## Overview

Implement thumbnail generation and retrieval for drive items. Returns preview images for files and folders in various sizes.

## References

- [List thumbnails](https://learn.microsoft.com/en-us/graph/api/driveitem-list-thumbnails?view=graph-rest-1.0)
- [ThumbnailSet resource](https://learn.microsoft.com/en-us/graph/api/resources/thumbnailset?view=graph-rest-1.0)

## Current State

- No thumbnail support
- Files are served as-is without previews

## API Specifications

### List Thumbnails

**Endpoint:** `GET /drives/{driveId}/items/{itemId}/thumbnails`

**Response:**
```json
{
  "@odata.context": "...",
  "value": [
    {
      "id": "0",
      "small": {
        "height": 96,
        "width": 96,
        "url": "https://..."
      },
      "medium": {
        "height": 176,
        "width": 176,
        "url": "https://..."
      },
      "large": {
        "height": 800,
        "width": 800,
        "url": "https://..."
      }
    }
  ]
}
```

### Get Specific Thumbnail

**Endpoint:** `GET /drives/{driveId}/items/{itemId}/thumbnails/{thumbnailId}/{size}`

Where `size` is `small`, `medium`, `large`, or custom size like `c200x200`.

**Response:** Binary image content

### Expand Thumbnails with Items

**Endpoint:** `GET /drives/{driveId}/root/children?$expand=thumbnails`

**Response:**
```json
{
  "value": [
    {
      "id": "item-id",
      "name": "photo.jpg",
      "thumbnails": [
        {
          "id": "0",
          "small": { "url": "...", "width": 96, "height": 96 },
          "medium": { "url": "...", "width": 176, "height": 176 },
          "large": { "url": "...", "width": 800, "height": 800 }
        }
      ]
    }
  ]
}
```

### Thumbnail Sizes

| Size | Max Dimension |
|------|---------------|
| small | 96px |
| medium | 176px |
| large | 800px |
| custom | e.g., c200x200 (crop), 200x200 (fit) |

## Implementation Steps

### Step 1: Add Thumbnail Cache Storage

Create directory structure:

```
data/
  .thumbnails/
    {item-id}/
      small.png
      medium.png
      large.png
```

Add to `src/services/database.ts`:

```sql
CREATE TABLE IF NOT EXISTS thumbnails (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  size TEXT NOT NULL,  -- 'small', 'medium', 'large', or custom
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  path TEXT NOT NULL,  -- Path to cached thumbnail
  mime_type TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  UNIQUE(item_id, size),
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX idx_thumbnails_item ON thumbnails(item_id);
```

### Step 2: Create Thumbnail Service

Create `src/services/thumbnails.ts`:

```typescript
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';  // Image processing library

interface Thumbnail {
  url: string;
  width: number;
  height: number;
}

interface ThumbnailSet {
  id: string;
  small?: Thumbnail;
  medium?: Thumbnail;
  large?: Thumbnail;
  source?: Thumbnail;
}

const SIZES = {
  small: 96,
  medium: 176,
  large: 800
};

const SUPPORTED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
  'application/pdf'  // Would need pdf-to-image library
];

export class ThumbnailService {
  private readonly THUMBNAIL_DIR = '.thumbnails';

  constructor(
    private db: DatabaseService,
    private fsService: FilesystemService,
    private config: Config
  ) {}

  async getThumbnails(itemId: string): Promise<ThumbnailSet[]> {
    const item = await this.db.getItem(itemId);
    if (!item) {
      throw GraphError.notFound('Item not found');
    }

    // Check if thumbnails are supported for this file type
    const mimeType = getMimeType(item.name);
    if (!this.canGenerateThumbnails(mimeType)) {
      return [];
    }

    // Get or generate thumbnails
    await this.ensureThumbnails(item);

    // Get cached thumbnails
    const thumbnails = this.db.prepare(`
      SELECT * FROM thumbnails WHERE item_id = ?
    `).all(itemId);

    if (thumbnails.length === 0) {
      return [];
    }

    // Format as ThumbnailSet
    const thumbnailSet: ThumbnailSet = { id: '0' };

    for (const thumb of thumbnails) {
      const size = thumb.size as 'small' | 'medium' | 'large';
      thumbnailSet[size] = {
        url: this.getThumbnailUrl(itemId, size),
        width: thumb.width,
        height: thumb.height
      };
    }

    return [thumbnailSet];
  }

  async getThumbnailContent(
    itemId: string,
    thumbnailId: string,
    size: string
  ): Promise<{ content: Buffer; mimeType: string }> {
    const item = await this.db.getItem(itemId);
    if (!item) {
      throw GraphError.notFound('Item not found');
    }

    // Parse custom size if specified (e.g., c200x200 or 200x200)
    const isCrop = size.startsWith('c');
    const sizeSpec = isCrop ? size.substring(1) : size;

    let targetSize: { width?: number; height?: number };

    if (sizeSpec in SIZES) {
      const maxDim = SIZES[sizeSpec as keyof typeof SIZES];
      targetSize = { width: maxDim, height: maxDim };
    } else {
      const match = sizeSpec.match(/^(\d+)x(\d+)$/);
      if (match) {
        targetSize = { width: parseInt(match[1]), height: parseInt(match[2]) };
      } else {
        throw GraphError.badRequest('Invalid thumbnail size');
      }
    }

    // Check cache first
    const cached = this.db.prepare(`
      SELECT * FROM thumbnails WHERE item_id = ? AND size = ?
    `).get(itemId, size);

    if (cached) {
      const content = await this.fsService.readFile(cached.path);
      return { content, mimeType: cached.mime_type };
    }

    // Generate thumbnail
    const thumbnail = await this.generateThumbnail(item, targetSize, isCrop);

    // Cache it
    const cachePath = path.join(this.THUMBNAIL_DIR, itemId, size + '.png');
    await this.fsService.writeFile(cachePath, thumbnail.content);

    this.db.prepare(`
      INSERT OR REPLACE INTO thumbnails (
        id, item_id, size, width, height, path, mime_type, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      generateId(),
      itemId,
      size,
      thumbnail.width,
      thumbnail.height,
      cachePath,
      'image/png',
      new Date().toISOString()
    );

    return { content: thumbnail.content, mimeType: 'image/png' };
  }

  async expandThumbnails(items: any[]): Promise<any[]> {
    return Promise.all(items.map(async (item) => {
      if (item.type !== 'file') return item;

      try {
        const thumbnails = await this.getThumbnails(item.id);
        return { ...item, thumbnails };
      } catch {
        return item;
      }
    }));
  }

  async invalidateThumbnails(itemId: string): Promise<void> {
    // Delete cached files
    const thumbnails = this.db.prepare(`
      SELECT path FROM thumbnails WHERE item_id = ?
    `).all(itemId);

    for (const thumb of thumbnails) {
      try {
        await this.fsService.deleteFile(thumb.path);
      } catch {
        // Ignore if already deleted
      }
    }

    // Remove from database
    this.db.prepare('DELETE FROM thumbnails WHERE item_id = ?').run(itemId);
  }

  private canGenerateThumbnails(mimeType: string): boolean {
    return SUPPORTED_TYPES.includes(mimeType);
  }

  private async ensureThumbnails(item: any): Promise<void> {
    const existingCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM thumbnails WHERE item_id = ?
    `).get(item.id).count;

    if (existingCount >= 3) return;  // All standard sizes exist

    const mimeType = getMimeType(item.name);
    if (!this.canGenerateThumbnails(mimeType)) return;

    // Generate missing thumbnails
    for (const [sizeName, maxDim] of Object.entries(SIZES)) {
      const existing = this.db.prepare(`
        SELECT id FROM thumbnails WHERE item_id = ? AND size = ?
      `).get(item.id, sizeName);

      if (!existing) {
        try {
          const thumbnail = await this.generateThumbnail(
            item,
            { width: maxDim, height: maxDim },
            false
          );

          const cachePath = path.join(this.THUMBNAIL_DIR, item.id, sizeName + '.png');
          await this.fsService.writeFile(cachePath, thumbnail.content);

          this.db.prepare(`
            INSERT INTO thumbnails (
              id, item_id, size, width, height, path, mime_type, generated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            generateId(),
            item.id,
            sizeName,
            thumbnail.width,
            thumbnail.height,
            cachePath,
            'image/png',
            new Date().toISOString()
          );
        } catch (error) {
          // Skip if generation fails
          logger.warn(`Failed to generate ${sizeName} thumbnail for ${item.id}:`, error);
        }
      }
    }
  }

  private async generateThumbnail(
    item: any,
    size: { width?: number; height?: number },
    crop: boolean
  ): Promise<{ content: Buffer; width: number; height: number }> {
    const content = await this.fsService.readFile(item.path);

    let image = sharp(content);
    const metadata = await image.metadata();

    if (crop) {
      // Crop to exact dimensions
      image = image.resize(size.width, size.height, {
        fit: 'cover',
        position: 'center'
      });
    } else {
      // Fit within dimensions, maintain aspect ratio
      image = image.resize(size.width, size.height, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    const output = await image.png().toBuffer();
    const outputMetadata = await sharp(output).metadata();

    return {
      content: output,
      width: outputMetadata.width!,
      height: outputMetadata.height!
    };
  }

  private getThumbnailUrl(itemId: string, size: string): string {
    return `${this.config.baseUrl}/v1.0/drives/{driveId}/items/${itemId}/thumbnails/0/${size}/content`;
  }
}
```

### Step 3: Add Thumbnail Routes

Add to `src/routes/drives.ts`:

```typescript
const thumbnailService = new ThumbnailService(db, fsService, config);

// GET /drives/:driveId/items/:itemId/thumbnails
router.get('/:driveId/items/:itemId/thumbnails', async (req, res) => {
  const { itemId } = req.params;

  const thumbnails = await thumbnailService.getThumbnails(itemId);

  res.json({
    '@odata.context': `${req.protocol}://${req.get('host')}${req.baseUrl}/$metadata#thumbnails`,
    value: thumbnails
  });
});

// GET /drives/:driveId/items/:itemId/thumbnails/:thumbnailId/:size
router.get('/:driveId/items/:itemId/thumbnails/:thumbnailId/:size', async (req, res) => {
  const { itemId, thumbnailId, size } = req.params;

  const { content, mimeType } = await thumbnailService.getThumbnailContent(
    itemId,
    thumbnailId,
    size
  );

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(content);
});

// GET /drives/:driveId/items/:itemId/thumbnails/:thumbnailId/:size/content
// Alias for the above
router.get('/:driveId/items/:itemId/thumbnails/:thumbnailId/:size/content', async (req, res) => {
  const { itemId, thumbnailId, size } = req.params;

  const { content, mimeType } = await thumbnailService.getThumbnailContent(
    itemId,
    thumbnailId,
    size
  );

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(content);
});
```

### Step 4: Support $expand=thumbnails

Update item listing handlers:

```typescript
// GET /drives/:driveId/root/children
router.get('/:driveId/root/children', async (req, res) => {
  const odataParams = req.odataParams;

  let items = await db.getChildren(driveId, 'root');

  // Expand thumbnails if requested
  if (odataParams.expand?.includes('thumbnails')) {
    items = await thumbnailService.expandThumbnails(items);
  }

  // ... rest of formatting and response
});

// Similar for /drives/:driveId/items/:itemId/children
```

### Step 5: Invalidate on File Update

```typescript
// In file update handler
router.put('/:driveId/items/:itemId/content', async (req, res) => {
  // ... existing upload logic ...

  // Invalidate thumbnails
  await thumbnailService.invalidateThumbnails(itemId);

  // ... response
});
```

### Step 6: Add Placeholder Thumbnails

For files that can't generate thumbnails, optionally return placeholders:

```typescript
private getPlaceholderThumbnail(mimeType: string): ThumbnailSet | null {
  // Return generic icons based on file type
  const iconMap: Record<string, string> = {
    'application/pdf': 'pdf-icon.png',
    'application/msword': 'word-icon.png',
    'application/vnd.ms-excel': 'excel-icon.png',
    // ... etc
  };

  const icon = iconMap[mimeType];
  if (!icon) return null;

  return {
    id: '0',
    small: { url: `/assets/icons/${icon}`, width: 96, height: 96 },
    medium: { url: `/assets/icons/${icon}`, width: 96, height: 96 },
    large: { url: `/assets/icons/${icon}`, width: 96, height: 96 }
  };
}
```

## Dependencies

Add to `package.json`:

```json
{
  "dependencies": {
    "sharp": "^0.33.0"
  }
}
```

Sharp requires native compilation. For Windows, may need build tools.

## Test Cases

```typescript
describe('Thumbnails API', () => {
  beforeAll(async () => {
    // Create test image file
    await createImageFile(driveId, 'test-image.png', 1000, 800);
  });

  describe('GET /drives/{id}/items/{id}/thumbnails', () => {
    test('returns thumbnail set for image', async () => {
      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/items/${imageItemId}/thumbnails`);

      expect(response.status).toBe(200);
      expect(response.body.value).toHaveLength(1);
      expect(response.body.value[0].small).toBeDefined();
      expect(response.body.value[0].medium).toBeDefined();
      expect(response.body.value[0].large).toBeDefined();
    });

    test('returns empty for unsupported file type', async () => {
      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/items/${textFileId}/thumbnails`);

      expect(response.status).toBe(200);
      expect(response.body.value).toHaveLength(0);
    });
  });

  describe('GET /drives/{id}/items/{id}/thumbnails/{id}/{size}', () => {
    test('returns small thumbnail', async () => {
      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/items/${imageItemId}/thumbnails/0/small`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
    });

    test('returns custom size thumbnail', async () => {
      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/items/${imageItemId}/thumbnails/0/200x200`);

      expect(response.status).toBe(200);
    });

    test('returns cropped thumbnail with c prefix', async () => {
      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/items/${imageItemId}/thumbnails/0/c150x150`);

      expect(response.status).toBe(200);
      // Verify exact dimensions
    });
  });

  describe('$expand=thumbnails', () => {
    test('includes thumbnails in children response', async () => {
      const response = await request(app)
        .get(`/v1.0/drives/${driveId}/root/children?$expand=thumbnails`);

      expect(response.status).toBe(200);

      const imageItem = response.body.value.find(i => i.name === 'test-image.png');
      expect(imageItem.thumbnails).toBeDefined();
      expect(imageItem.thumbnails).toHaveLength(1);
    });
  });
});
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/services/thumbnails.ts` | Create - Thumbnail generation |
| `src/services/database.ts` | Modify - Add thumbnails table |
| `src/routes/drives.ts` | Modify - Add thumbnail endpoints, expand support |
| `package.json` | Modify - Add sharp dependency |
| `tests/routes/thumbnails.test.ts` | Create - Thumbnail tests |

## Limitations

- Only image files supported (no PDF, video, or Office docs)
- No animated GIF frame extraction
- Thumbnails regenerated on demand (no background processing)
- Sharp requires native compilation
- Custom sizes limited to reasonable ranges

## Alternative: Placeholder-Only Mode

If Sharp is not available or desired, implement placeholder-only mode:

```typescript
// Return generic type icons instead of actual thumbnails
async getThumbnails(itemId: string): Promise<ThumbnailSet[]> {
  const item = await this.db.getItem(itemId);
  const mimeType = getMimeType(item.name);

  // Return placeholder based on file type
  const placeholder = this.getPlaceholder(mimeType);
  return placeholder ? [placeholder] : [];
}
```

## Success Criteria

1. List thumbnails returns small/medium/large for images
2. Get specific size returns correct dimensions
3. Custom sizes (200x200) work
4. Crop mode (c200x200) works
5. `$expand=thumbnails` includes thumbnails in item listings
6. Unsupported file types return empty array
7. Thumbnails cached and reused
8. Thumbnails invalidated on file update
