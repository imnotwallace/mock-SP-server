import { EnhancedDriveItem } from './metadata.js';

/**
 * Deleted item representation in delta response
 */
export interface DeletedFacet {
  state: 'deleted';
}

/**
 * Item in delta response (either full item or deleted stub)
 */
export interface DeltaItem extends Partial<EnhancedDriveItem> {
  id: string;
  deleted?: DeletedFacet;
}

/**
 * Delta query response
 */
export interface DeltaResponse {
  '@odata.context': string;
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
  value: DeltaItem[];
}

/**
 * Result from delta query processing
 */
export interface DeltaResult {
  items: DeltaItem[];
  nextPageToken: string | null;
  deltaToken: string | null;
}
