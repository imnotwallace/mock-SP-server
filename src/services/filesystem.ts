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

export class FilesystemService {
  private rootDir: string;
  private db: Database;

  constructor(rootDir: string, db: Database) {
    this.rootDir = path.resolve(rootDir);
    this.db = db;
  }

  /**
   * Scans the filesystem hierarchy and populates the database
   * Level 0: site collections (directories in root)
   * Level 1: sites (directories in site collection)
   * Level 2: libraries (directories in site)
   * Level 3+: files and folders (within libraries)
   */
  scan(): void {
    this.scanDirectory(this.rootDir, undefined, 0);
  }

  private scanDirectory(dirPath: string, parentId: string | undefined, level: number): void {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip metadata files and version directories
      if (entry.name.startsWith('_') || entry.name === '.versions') {
        continue;
      }

      const entryPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(this.rootDir, entryPath);
      const id = pathToId(relativePath);

      if (entry.isDirectory()) {
        const type = this.determineType(level);
        const stats = fs.statSync(entryPath);

        const item: ItemRecord = {
          id,
          path: relativePath.replace(/\\/g, '/'),
          type,
          parentId,
          name: entry.name,
          createdAt: stats.birthtime.toISOString(),
          modifiedAt: stats.mtime.toISOString(),
        };

        this.db.upsertItem(item);

        // Load and store metadata for site collections and libraries
        if (type === 'siteCollection') {
          this.loadSiteMetadata(entryPath, id);
        } else if (type === 'library') {
          this.loadLibraryMetadata(entryPath, id);
        }

        // Recursively scan subdirectories
        this.scanDirectory(entryPath, id, level + 1);
      } else if (entry.isFile() && level >= 3) {
        // Files are only tracked at level 3+ (within libraries)
        const stats = fs.statSync(entryPath);

        const item: ItemRecord = {
          id,
          path: relativePath.replace(/\\/g, '/'),
          type: 'file',
          parentId,
          name: entry.name,
          createdAt: stats.birthtime.toISOString(),
          modifiedAt: stats.mtime.toISOString(),
          size: stats.size,
        };

        this.db.upsertItem(item);

        // Apply file metadata if available
        const filesMetadata = this.loadFilesMetadata(dirPath);
        if (filesMetadata[entry.name]) {
          this.applyFileMetadata(id, filesMetadata[entry.name]);
        }
      }
    }
  }

  private determineType(level: number): ItemRecord['type'] {
    switch (level) {
      case 0:
        return 'siteCollection';
      case 1:
        return 'site';
      case 2:
        return 'library';
      default:
        return 'folder';
    }
  }

  private loadSiteMetadata(siteDir: string, siteId: string): void {
    const metadataPath = path.join(siteDir, '_site.json');
    if (fs.existsSync(metadataPath)) {
      try {
        const content = fs.readFileSync(metadataPath, 'utf-8');
        const metadata: SiteMetadata = JSON.parse(content);

        if (metadata.displayName) {
          this.db.setFieldValue(siteId, 'displayName', metadata.displayName);
        }
        if (metadata.description) {
          this.db.setFieldValue(siteId, 'description', metadata.description);
        }
      } catch (error) {
        // Silently ignore malformed metadata files
      }
    }
  }

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

  /**
   * Gets the root directory path
   */
  getRootDir(): string {
    return this.rootDir;
  }

  /**
   * Gets the absolute filesystem path for a relative path
   */
  getAbsolutePath(relativePath: string): string {
    return path.join(this.rootDir, relativePath);
  }

  /**
   * Checks if a file exists
   */
  fileExists(relativePath: string): boolean {
    const absPath = this.getAbsolutePath(relativePath);
    return fs.existsSync(absPath);
  }

  /**
   * Reads a file's contents
   */
  readFile(relativePath: string): Buffer {
    const absPath = this.getAbsolutePath(relativePath);
    return fs.readFileSync(absPath);
  }

  /**
   * Writes content to a file
   */
  writeFile(relativePath: string, content: Buffer | string): void {
    const absPath = this.getAbsolutePath(relativePath);
    const dirPath = path.dirname(absPath);

    // Ensure directory exists
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    fs.writeFileSync(absPath, content);
  }

  /**
   * Deletes a file
   */
  deleteFile(relativePath: string): void {
    const absPath = this.getAbsolutePath(relativePath);
    if (fs.existsSync(absPath)) {
      fs.unlinkSync(absPath);
    }
  }

  /**
   * Moves a file or folder from one path to another
   */
  moveFile(oldRelativePath: string, newRelativePath: string): void {
    const oldAbsPath = this.getAbsolutePath(oldRelativePath);
    const newAbsPath = this.getAbsolutePath(newRelativePath);

    // Ensure target directory exists
    const targetDir = path.dirname(newAbsPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Move file/folder
    fs.renameSync(oldAbsPath, newAbsPath);
  }

  /**
   * Creates a directory
   */
  createDirectory(relativePath: string): void {
    const absPath = this.getAbsolutePath(relativePath);
    fs.mkdirSync(absPath, { recursive: true });
  }

  /**
   * Loads list items from a _items.json metadata file
   */
  loadListItems(libraryPath: string): any[] {
    const absPath = this.getAbsolutePath(libraryPath);
    const itemsPath = path.join(absPath, '_items.json');

    if (!fs.existsSync(itemsPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(itemsPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return [];
    }
  }

  /**
   * Saves list items to a _items.json metadata file
   */
  saveListItems(libraryPath: string, items: any[]): void {
    const absPath = this.getAbsolutePath(libraryPath);
    const itemsPath = path.join(absPath, '_items.json');

    // Ensure directory exists
    if (!fs.existsSync(absPath)) {
      fs.mkdirSync(absPath, { recursive: true });
    }

    fs.writeFileSync(itemsPath, JSON.stringify(items, null, 2), 'utf-8');
  }
}
