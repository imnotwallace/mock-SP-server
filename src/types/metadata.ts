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
