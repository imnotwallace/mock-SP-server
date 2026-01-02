import { Database, ItemRecord } from './database.js';
import { EnhancedDriveItem } from '../types/index.js';
import { getMimeType } from '../utils/index.js';

/**
 * Search query parameters
 */
export interface SearchQuery {
  queryString: string;
  entityTypes: ('driveItem' | 'listItem' | 'list' | 'site')[];
  from?: number;
  size?: number;
  fields?: string[];
}

/**
 * Search hit result
 */
export interface SearchHit {
  hitId: string;
  rank: number;
  summary: string;
  resource: any;
}

/**
 * Search result container
 */
export interface SearchResult {
  searchTerms: string[];
  hitsContainers: {
    hits: SearchHit[];
    total: number;
    moreResultsAvailable: boolean;
  }[];
}

/**
 * Parsed query components
 */
interface ParsedQuery {
  terms: string[];
  filters: Record<string, string>;
}

/**
 * Search service for Microsoft Search API
 */
export class SearchService {
  constructor(private db: Database) {}

  /**
   * Execute search query
   */
  async search(query: SearchQuery): Promise<SearchResult> {
    const { queryString, entityTypes, from = 0, size = 25 } = query;

    // Parse the query string
    const { terms, filters } = this.parseQueryString(queryString);

    // Collect all hits
    const allHits: SearchHit[] = [];

    // Search each entity type
    if (entityTypes.includes('driveItem')) {
      const driveItems = this.searchDriveItems(terms, filters);
      allHits.push(...driveItems);
    }

    if (entityTypes.includes('listItem')) {
      const listItems = this.searchListItems(terms, filters);
      allHits.push(...listItems);
    }

    if (entityTypes.includes('site')) {
      const sites = this.searchSites(terms, filters);
      allHits.push(...sites);
    }

    if (entityTypes.includes('list')) {
      const lists = this.searchLists(terms, filters);
      allHits.push(...lists);
    }

    // Sort by relevance (rank descending)
    allHits.sort((a, b) => b.rank - a.rank);

    // Apply pagination
    const paginatedHits = allHits.slice(from, from + size);

    return {
      searchTerms: terms,
      hitsContainers: [{
        hits: paginatedHits,
        total: allHits.length,
        moreResultsAvailable: from + size < allHits.length
      }]
    };
  }

  /**
   * Search within a specific drive
   */
  searchInDrive(driveId: string, queryString: string): {
    items: EnhancedDriveItem[];
    total: number;
  } {
    const { terms, filters } = this.parseQueryString(queryString);

    // Get the drive (library) item
    const drive = this.db.getItemById(driveId);
    if (!drive) {
      return { items: [], total: 0 };
    }

    // Build SQL query to find items in this drive
    let sql = `
      SELECT i.*
      FROM items i
      WHERE i.type IN ('file', 'folder')
    `;
    const params: any[] = [];

    // Filter by drive path (all descendants)
    sql += ` AND (i.id = ? OR i.path LIKE ?)`;
    params.push(driveId, `${drive.path}/%`);

    // Apply text search on name
    if (terms.length > 0) {
      const termConditions = terms.map(() => 'i.name LIKE ?').join(' AND ');
      sql += ` AND (${termConditions})`;
      params.push(...terms.map(t => `%${t}%`));
    }

    // Apply filters
    if (filters.filetype) {
      sql += ` AND i.name LIKE ?`;
      params.push(`%.${filters.filetype}`);
    }

    if (filters.isdocument === 'true') {
      sql += ` AND i.type = 'file'`;
    }

    sql += ` ORDER BY i.name LIMIT 200`;

    const stmt = this.db.raw.prepare(sql);
    const rows = stmt.all(...params) as any[];

    // Map database rows to ItemRecords (convert snake_case to camelCase)
    const items: ItemRecord[] = rows.map(row => ({
      id: row.id,
      path: row.path,
      type: row.type,
      parentId: row.parent_id,
      name: row.name,
      createdAt: row.created_at,
      modifiedAt: row.modified_at,
      etag: row.etag,
      size: row.size
    }));

    // Build enhanced items
    const enhancedItems = items.map(item => this.buildEnhancedItem(item));

    return {
      items: enhancedItems,
      total: items.length
    };
  }

  /**
   * Parse KQL-style query string into terms and filters
   */
  private parseQueryString(queryString: string): ParsedQuery {
    const filters: Record<string, string> = {};
    const terms: string[] = [];

    // Parse KQL-style filters: filetype:docx, path:"...", isDocument:true
    const tokens = queryString.match(/(\w+:"[^"]+"|"[^"]+"|[^\s]+)/g) || [];

    for (const token of tokens) {
      // Check if it's a filter (key:value)
      const colonIndex = token.indexOf(':');
      if (colonIndex > 0 && !token.startsWith('"')) {
        const key = token.substring(0, colonIndex);
        const value = token.substring(colonIndex + 1).replace(/^"|"$/g, '');
        filters[key.toLowerCase()] = value;
      } else {
        // It's a search term
        terms.push(token.replace(/^"|"$/g, ''));
      }
    }

    return { terms, filters };
  }

  /**
   * Search drive items (files and folders)
   */
  private searchDriveItems(terms: string[], filters: Record<string, string>): SearchHit[] {
    let sql = `
      SELECT i.*
      FROM items i
      WHERE i.type IN ('file', 'folder')
    `;
    const params: any[] = [];

    // Apply text search on name
    if (terms.length > 0) {
      const termConditions = terms.map(() => 'i.name LIKE ?').join(' AND ');
      sql += ` AND (${termConditions})`;
      params.push(...terms.map(t => `%${t}%`));
    }

    // Apply filters
    if (filters.filetype) {
      sql += ` AND i.name LIKE ?`;
      params.push(`%.${filters.filetype}`);
    }

    if (filters.path) {
      sql += ` AND i.path LIKE ?`;
      params.push(`${filters.path}%`);
    }

    if (filters.isdocument === 'true') {
      sql += ` AND i.type = 'file'`;
    }

    sql += ` LIMIT 500`; // Fetch extra for ranking

    const stmt = this.db.raw.prepare(sql);
    const rows = stmt.all(...params) as any[];

    // Map database rows to ItemRecords
    const items: ItemRecord[] = rows.map(row => ({
      id: row.id,
      path: row.path,
      type: row.type,
      parentId: row.parent_id,
      name: row.name,
      createdAt: row.created_at,
      modifiedAt: row.modified_at,
      etag: row.etag,
      size: row.size
    }));

    return items.map(item => {
      const enhanced = this.buildEnhancedItem(item);
      return {
        hitId: item.id,
        rank: this.calculateRank(item, terms),
        summary: this.generateSummary(item, terms),
        resource: {
          '@odata.type': '#microsoft.graph.driveItem',
          ...enhanced
        }
      };
    });
  }

  /**
   * Search list items
   */
  private searchListItems(terms: string[], filters: Record<string, string>): SearchHit[] {
    let sql = `
      SELECT i.*
      FROM items i
      WHERE i.type = 'listItem'
    `;
    const params: any[] = [];

    // Apply text search on name
    if (terms.length > 0) {
      const termConditions = terms.map(() => 'i.name LIKE ?').join(' AND ');
      sql += ` AND (${termConditions})`;
      params.push(...terms.map(t => `%${t}%`));
    }

    sql += ` LIMIT 500`;

    const stmt = this.db.raw.prepare(sql);
    const rows = stmt.all(...params) as any[];

    // Map database rows to ItemRecords
    const items: ItemRecord[] = rows.map(row => ({
      id: row.id,
      path: row.path,
      type: row.type,
      parentId: row.parent_id,
      name: row.name,
      createdAt: row.created_at,
      modifiedAt: row.modified_at,
      etag: row.etag,
      size: row.size
    }));

    return items.map(item => ({
      hitId: item.id,
      rank: this.calculateRank(item, terms),
      summary: this.generateSummary(item, terms),
      resource: {
        '@odata.type': '#microsoft.graph.listItem',
        id: item.id,
        name: item.name,
        createdDateTime: item.createdAt,
        lastModifiedDateTime: item.modifiedAt
      }
    }));
  }

  /**
   * Search sites
   */
  private searchSites(terms: string[], filters: Record<string, string>): SearchHit[] {
    let sql = `
      SELECT i.*
      FROM items i
      WHERE i.type IN ('site', 'siteCollection')
    `;
    const params: any[] = [];

    // Apply text search on name
    if (terms.length > 0) {
      const termConditions = terms.map(() => 'i.name LIKE ?').join(' AND ');
      sql += ` AND (${termConditions})`;
      params.push(...terms.map(t => `%${t}%`));
    }

    sql += ` LIMIT 500`;

    const stmt = this.db.raw.prepare(sql);
    const rows = stmt.all(...params) as any[];

    // Map database rows to ItemRecords
    const items: ItemRecord[] = rows.map(row => ({
      id: row.id,
      path: row.path,
      type: row.type,
      parentId: row.parent_id,
      name: row.name,
      createdAt: row.created_at,
      modifiedAt: row.modified_at,
      etag: row.etag,
      size: row.size
    }));

    return items.map(item => ({
      hitId: item.id,
      rank: this.calculateRank(item, terms),
      summary: this.generateSummary(item, terms),
      resource: {
        '@odata.type': '#microsoft.graph.site',
        id: item.id,
        name: item.name,
        displayName: item.name,
        createdDateTime: item.createdAt,
        lastModifiedDateTime: item.modifiedAt
      }
    }));
  }

  /**
   * Search lists/libraries
   */
  private searchLists(terms: string[], filters: Record<string, string>): SearchHit[] {
    let sql = `
      SELECT i.*
      FROM items i
      WHERE i.type IN ('list', 'library')
    `;
    const params: any[] = [];

    // Apply text search on name
    if (terms.length > 0) {
      const termConditions = terms.map(() => 'i.name LIKE ?').join(' AND ');
      sql += ` AND (${termConditions})`;
      params.push(...terms.map(t => `%${t}%`));
    }

    sql += ` LIMIT 500`;

    const stmt = this.db.raw.prepare(sql);
    const rows = stmt.all(...params) as any[];

    // Map database rows to ItemRecords
    const items: ItemRecord[] = rows.map(row => ({
      id: row.id,
      path: row.path,
      type: row.type,
      parentId: row.parent_id,
      name: row.name,
      createdAt: row.created_at,
      modifiedAt: row.modified_at,
      etag: row.etag,
      size: row.size
    }));

    return items.map(item => ({
      hitId: item.id,
      rank: this.calculateRank(item, terms),
      summary: this.generateSummary(item, terms),
      resource: {
        '@odata.type': '#microsoft.graph.list',
        id: item.id,
        name: item.name,
        displayName: item.name,
        createdDateTime: item.createdAt,
        lastModifiedDateTime: item.modifiedAt
      }
    }));
  }

  /**
   * Calculate relevance rank for an item
   */
  private calculateRank(item: ItemRecord, terms: string[]): number {
    let rank = 0;
    const nameLower = item.name.toLowerCase();

    for (const term of terms) {
      const termLower = term.toLowerCase();
      if (nameLower === termLower) {
        rank += 100; // Exact match
      } else if (nameLower.startsWith(termLower)) {
        rank += 50; // Prefix match
      } else if (nameLower.includes(termLower)) {
        rank += 25; // Contains
      }
    }

    return rank;
  }

  /**
   * Generate summary snippet for search result
   */
  private generateSummary(item: ItemRecord, terms: string[]): string {
    // Try to get content preview from field values
    const stmt = this.db.raw.prepare(`
      SELECT field_value
      FROM field_values
      WHERE item_id = ? AND field_name = 'contentPreview'
      LIMIT 1
    `);
    const result = stmt.get(item.id) as { field_value: string } | undefined;

    const preview = result?.field_value || item.name;

    // Truncate to reasonable length
    return preview.substring(0, 200);
  }

  /**
   * Build enhanced drive item with Graph API fields
   */
  private buildEnhancedItem(item: ItemRecord): EnhancedDriveItem {
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
    }

    // Add folder object for folders
    if (item.type === 'folder') {
      const children = this.db.getItemsByParent(item.id);
      enhanced.folder = { childCount: children.length };
    }

    // Get field values from database
    const fieldValues = this.db.getFieldValues(item.id);

    // Build createdBy if available
    const createdByName = fieldValues.find(f => f.fieldName === 'createdBy.displayName');
    const createdByEmail = fieldValues.find(f => f.fieldName === 'createdBy.email');
    if (createdByName || createdByEmail) {
      enhanced.createdBy = {
        user: {
          displayName: createdByName?.fieldValue,
          email: createdByEmail?.fieldValue
        }
      };
    }

    // Build lastModifiedBy if available
    const modifiedByName = fieldValues.find(f => f.fieldName === 'lastModifiedBy.displayName');
    const modifiedByEmail = fieldValues.find(f => f.fieldName === 'lastModifiedBy.email');
    if (modifiedByName || modifiedByEmail) {
      enhanced.lastModifiedBy = {
        user: {
          displayName: modifiedByName?.fieldValue,
          email: modifiedByEmail?.fieldValue
        }
      };
    }

    // Add parentReference if available
    if (item.parentId) {
      const parent = this.db.getItemById(item.parentId);
      if (parent) {
        // Find the drive (library) ancestor
        let driveId = item.parentId;
        let current = parent;
        while (current && current.type !== 'library') {
          if (current.parentId) {
            driveId = current.parentId;
            const next = this.db.getItemById(current.parentId);
            current = next || current;
            if (!next) break;
          } else {
            break;
          }
        }

        enhanced.parentReference = {
          driveId: driveId || item.parentId,
          driveType: 'documentLibrary',
          id: item.parentId
        };
      }
    }

    return enhanced;
  }
}
