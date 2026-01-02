import * as path from 'path';
import { Database } from './database.js';
import { FilesystemService } from './filesystem.js';
import { GraphError } from '../middleware/error.js';
import { generateId } from '../utils/index.js';

export interface DriveItemVersion {
  id: string;
  lastModifiedDateTime: string;
  lastModifiedBy: {
    user: {
      id?: string;
      displayName?: string;
      email?: string;
    };
  };
  size: number;
}

export interface VersionCreatedBy {
  id?: string;
  email?: string;
  displayName?: string;
}

export class VersionsService {
  constructor(
    private db: Database,
    private fsService: FilesystemService
  ) {}

  /**
   * List all versions for a file
   */
  listVersions(itemId: string): DriveItemVersion[] {
    const item = this.db.getItemById(itemId);
    if (!item || item.type !== 'file') {
      throw GraphError.notFound('File not found');
    }

    const versions = this.db.raw.prepare(`
      SELECT * FROM versions
      WHERE item_id = ?
      ORDER BY created_at DESC
    `).all(itemId);

    return (versions as any[]).map(v => this.formatVersion(v));
  }

  /**
   * Get a specific version by ID
   */
  getVersion(itemId: string, versionId: string): DriveItemVersion | null {
    const version = this.db.raw.prepare(`
      SELECT * FROM versions
      WHERE item_id = ? AND version_number = ?
    `).get(itemId, versionId);

    if (!version) return null;

    return this.formatVersion(version);
  }

  /**
   * Get the content of a specific version
   */
  getVersionContent(itemId: string, versionId: string): Buffer {
    const version = this.db.raw.prepare(`
      SELECT content_path FROM versions
      WHERE item_id = ? AND version_number = ?
    `).get(itemId, versionId) as any;

    if (!version) {
      throw GraphError.notFound('Version not found');
    }

    try {
      return this.fsService.readFile(version.content_path);
    } catch (error) {
      throw GraphError.notFound('Version content not found on disk');
    }
  }

  /**
   * Create a new version from current file content
   */
  createVersion(
    itemId: string,
    currentContent: Buffer,
    modifiedBy?: VersionCreatedBy
  ): void {
    const item = this.db.getItemById(itemId);
    if (!item) return;

    // Get next version number
    const lastVersion = this.db.raw.prepare(`
      SELECT version_number FROM versions
      WHERE item_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(itemId) as any;

    const nextVersionNum = lastVersion
      ? `${parseFloat(lastVersion.version_number) + 1}.0`
      : '1.0';

    // Store version content
    const versionDir = this.getVersionsDir(item.path);
    const versionPath = path.join(versionDir, nextVersionNum);

    // Ensure version directory exists
    this.fsService.createDirectory(path.dirname(versionPath));
    this.fsService.writeFile(versionPath, currentContent);

    // Record in database
    const versionId = generateId(`${itemId}-${nextVersionNum}-${Date.now()}`);
    this.db.raw.prepare(`
      INSERT INTO versions (
        id, item_id, version_number, content_path, size,
        created_at, created_by_id, created_by_email, created_by_display_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      itemId,
      nextVersionNum,
      versionPath,
      currentContent.length,
      new Date().toISOString(),
      modifiedBy?.id ?? null,
      modifiedBy?.email ?? null,
      modifiedBy?.displayName ?? null
    );
  }

  /**
   * Restore a previous version (makes it the current version)
   */
  async restoreVersion(itemId: string, versionId: string): Promise<void> {
    const item = this.db.getItemById(itemId);
    if (!item) {
      throw GraphError.notFound('Item not found');
    }

    const version = this.getVersion(itemId, versionId);
    if (!version) {
      throw GraphError.notFound('Version not found');
    }

    // Get current content (to save as new version)
    const currentContent = this.fsService.readFile(item.path);

    // Get version content
    const versionContent = this.getVersionContent(itemId, versionId);

    // Create new version from current content before overwriting
    this.createVersion(itemId, currentContent, {
      displayName: 'System (Restore)'
    });

    // Overwrite current file with version content
    this.fsService.writeFile(item.path, versionContent);

    // Update item metadata
    this.db.upsertItem({
      ...item,
      size: versionContent.length,
      modifiedAt: new Date().toISOString()
    });
  }

  /**
   * Delete a specific version
   */
  deleteVersion(itemId: string, versionId: string): void {
    const version = this.db.raw.prepare(`
      SELECT content_path FROM versions
      WHERE item_id = ? AND version_number = ?
    `).get(itemId, versionId) as any;

    if (!version) {
      throw GraphError.notFound('Version not found');
    }

    // Delete version file
    try {
      this.fsService.deleteFile(version.content_path);
    } catch (error) {
      // Continue even if file doesn't exist
    }

    // Remove from database
    this.db.raw.prepare(`
      DELETE FROM versions WHERE item_id = ? AND version_number = ?
    `).run(itemId, versionId);
  }

  /**
   * Get the directory path for storing versions of a file
   */
  private getVersionsDir(itemPath: string): string {
    const dir = path.dirname(itemPath);
    const name = path.basename(itemPath);
    return path.join(dir, '.versions', name);
  }

  /**
   * Format a database row into a DriveItemVersion object
   */
  private formatVersion(dbRow: any): DriveItemVersion {
    return {
      id: dbRow.version_number,
      lastModifiedDateTime: dbRow.created_at,
      lastModifiedBy: {
        user: {
          id: dbRow.created_by_id,
          displayName: dbRow.created_by_display_name,
          email: dbRow.created_by_email
        }
      },
      size: dbRow.size
    };
  }
}
