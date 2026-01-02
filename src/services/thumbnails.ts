import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import sharp from 'sharp';
import { Database, ItemRecord } from './database.js';
import { generateId } from '../utils/index.js';
import { getMimeType } from '../utils/index.js';
import {
  Thumbnail,
  ThumbnailSet,
  ThumbnailRecord,
  THUMBNAIL_SIZES,
  ThumbnailSizeName,
  SUPPORTED_THUMBNAIL_TYPES
} from '../types/thumbnail.js';

export class ThumbnailService {
  private readonly THUMBNAIL_DIR = '.thumbnails';
  private rootDir: string;

  constructor(
    private db: Database,
    rootDir: string
  ) {
    this.rootDir = path.resolve(rootDir);
    this.ensureThumbnailDirectory();
  }

  private ensureThumbnailDirectory(): void {
    const thumbnailPath = path.join(this.rootDir, this.THUMBNAIL_DIR);
    if (!fs.existsSync(thumbnailPath)) {
      fs.mkdirSync(thumbnailPath, { recursive: true });
    }
  }

  async getThumbnails(itemId: string, baseUrl: string): Promise<ThumbnailSet[]> {
    const item = this.db.getItemById(itemId);
    if (!item) {
      throw new Error('Item not found');
    }

    if (item.type !== 'file') {
      return [];
    }

    const mimeType = getMimeType(item.name);
    if (!this.canGenerateThumbnails(mimeType)) {
      return [];
    }

    await this.ensureThumbnails(item);

    const thumbnails = this.db.raw
      .prepare('SELECT * FROM thumbnails WHERE item_id = ?')
      .all(itemId) as ThumbnailRecord[];

    if (thumbnails.length === 0) {
      return [];
    }

    const thumbnailSet: ThumbnailSet = { id: '0' };

    for (const thumb of thumbnails) {
      const sizeName = thumb.size as ThumbnailSizeName;
      if (sizeName in THUMBNAIL_SIZES) {
        thumbnailSet[sizeName] = {
          url: `${baseUrl}/thumbnails/0/${sizeName}/content`,
          width: thumb.width,
          height: thumb.height
        };
      }
    }

    return [thumbnailSet];
  }

  async getThumbnailContent(
    itemId: string,
    size: string
  ): Promise<{ content: Buffer; mimeType: string; width: number; height: number }> {
    const item = this.db.getItemById(itemId);
    if (!item) {
      throw new Error('Item not found');
    }

    const { width, height, isCrop } = this.parseSizeSpec(size);

    const cached = this.db.raw
      .prepare('SELECT * FROM thumbnails WHERE item_id = ? AND size = ?')
      .get(itemId, size) as ThumbnailRecord | undefined;

    if (cached) {
      const thumbnailPath = path.join(this.rootDir, cached.path);
      if (fs.existsSync(thumbnailPath)) {
        const content = await fsPromises.readFile(thumbnailPath);
        return {
          content,
          mimeType: cached.mime_type,
          width: cached.width,
          height: cached.height
        };
      }
    }

    const thumbnail = await this.generateThumbnail(item, width, height, isCrop);
    const cachePath = path.join(
      this.THUMBNAIL_DIR,
      itemId,
      `${size}.png`
    );
    const fullCachePath = path.join(this.rootDir, cachePath);

    const cacheDir = path.dirname(fullCachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    await fsPromises.writeFile(fullCachePath, thumbnail.content);

    this.db.raw
      .prepare(
        `INSERT OR REPLACE INTO thumbnails (
          id, item_id, size, width, height, path, mime_type, generated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        generateId(`thumbnail-${itemId}-${size}`),
        itemId,
        size,
        thumbnail.width,
        thumbnail.height,
        cachePath,
        'image/png',
        new Date().toISOString()
      );

    return {
      content: thumbnail.content,
      mimeType: 'image/png',
      width: thumbnail.width,
      height: thumbnail.height
    };
  }

  async expandThumbnails(items: any[], baseUrl: string): Promise<any[]> {
    return Promise.all(
      items.map(async (item) => {
        if (item.file) {
          try {
            const thumbnails = await this.getThumbnails(item.id, baseUrl);
            return { ...item, thumbnails };
          } catch {
            return item;
          }
        }
        return item;
      })
    );
  }

  async invalidateThumbnails(itemId: string): Promise<void> {
    const thumbnails = this.db.raw
      .prepare('SELECT path FROM thumbnails WHERE item_id = ?')
      .all(itemId) as Pick<ThumbnailRecord, 'path'>[];

    for (const thumb of thumbnails) {
      try {
        const fullPath = path.join(this.rootDir, thumb.path);
        if (fs.existsSync(fullPath)) {
          await fsPromises.unlink(fullPath);
        }
      } catch {
        // Ignore errors
      }
    }

    this.db.raw.prepare('DELETE FROM thumbnails WHERE item_id = ?').run(itemId);
  }

  private canGenerateThumbnails(mimeType: string): boolean {
    return SUPPORTED_THUMBNAIL_TYPES.includes(mimeType);
  }

  private async ensureThumbnails(item: ItemRecord): Promise<void> {
    const existingCount = (
      this.db.raw
        .prepare('SELECT COUNT(*) as count FROM thumbnails WHERE item_id = ?')
        .get(item.id) as { count: number }
    ).count;

    if (existingCount >= 3) return;

    const mimeType = getMimeType(item.name);
    if (!this.canGenerateThumbnails(mimeType)) return;

    for (const [sizeName, maxDim] of Object.entries(THUMBNAIL_SIZES)) {
      const existing = this.db.raw
        .prepare('SELECT id FROM thumbnails WHERE item_id = ? AND size = ?')
        .get(item.id, sizeName);

      if (!existing) {
        try {
          const thumbnail = await this.generateThumbnail(item, maxDim, maxDim, false);
          const cachePath = path.join(
            this.THUMBNAIL_DIR,
            item.id,
            `${sizeName}.png`
          );
          const fullCachePath = path.join(this.rootDir, cachePath);

          const cacheDir = path.dirname(fullCachePath);
          if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
          }

          await fsPromises.writeFile(fullCachePath, thumbnail.content);

          this.db.raw
            .prepare(
              `INSERT INTO thumbnails (
                id, item_id, size, width, height, path, mime_type, generated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              generateId(`thumbnail-${item.id}-${sizeName}`),
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
          console.warn(`Failed to generate ${sizeName} thumbnail for ${item.id}:`, error);
        }
      }
    }
  }

  private async generateThumbnail(
    item: ItemRecord,
    width: number,
    height: number,
    crop: boolean
  ): Promise<{ content: Buffer; width: number; height: number }> {
    const itemPath = path.join(this.rootDir, item.path);
    const content = await fsPromises.readFile(itemPath);

    let image = sharp(content);
    const metadata = await image.metadata();

    if (crop) {
      image = image.resize(width, height, {
        fit: 'cover',
        position: 'center'
      });
    } else {
      image = image.resize(width, height, {
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

  private parseSizeSpec(size: string): { width: number; height: number; isCrop: boolean } {
    const isCrop = size.startsWith('c');
    const sizeSpec = isCrop ? size.substring(1) : size;

    if (sizeSpec in THUMBNAIL_SIZES) {
      const maxDim = THUMBNAIL_SIZES[sizeSpec as ThumbnailSizeName];
      return { width: maxDim, height: maxDim, isCrop };
    }

    const match = sizeSpec.match(/^(\d+)x(\d+)$/);
    if (match) {
      return {
        width: parseInt(match[1]),
        height: parseInt(match[2]),
        isCrop
      };
    }

    throw new Error('Invalid thumbnail size');
  }
}
