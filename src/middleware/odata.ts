import { Request, Response, NextFunction } from 'express';
import { PAGINATION } from '../config/types.js';
import { decodeSkipToken, generateNextLink } from '../utils/skiptoken.js';

/**
 * OData query options parsed from request query string
 */
export interface ODataQuery {
  $select?: string[];
  $expand?: string[];
  $filter?: string;
  $orderby?: string;
  $top?: number;
  $skip?: number;
  $count?: boolean;
  $search?: string;
  $skiptoken?: string;
}

/**
 * OData collection response wrapper
 */
export interface ODataResponse<T = any> {
  '@odata.context': string;
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
  value: T[];
}

/**
 * Parse OData query parameters from Express request
 */
export function parseODataQuery(req: Request): ODataQuery {
  const query: ODataQuery = {};

  // Handle $skiptoken first - it overrides $skip and $top
  let skip = 0;
  let top = PAGINATION.DEFAULT_PAGE_SIZE;

  if (req.query.$skiptoken) {
    const tokenPayload = decodeSkipToken(String(req.query.$skiptoken));
    if (tokenPayload) {
      skip = tokenPayload.skip;
      top = tokenPayload.top || PAGINATION.DEFAULT_PAGE_SIZE;
      query.$skiptoken = String(req.query.$skiptoken);

      // Apply preserved query params from skiptoken
      if (tokenPayload.filter) {
        query.$filter = tokenPayload.filter;
      }
      if (tokenPayload.orderBy) {
        query.$orderby = tokenPayload.orderBy;
      }
      if (tokenPayload.select) {
        query.$select = tokenPayload.select.split(',').map(s => s.trim());
      }
      if (tokenPayload.expand) {
        query.$expand = tokenPayload.expand.split(',').map(s => s.trim());
      }
    }
  } else {
    // Parse regular query params
    if (req.query.$skip) {
      const parsedSkip = parseInt(String(req.query.$skip), 10);
      if (!isNaN(parsedSkip) && parsedSkip >= 0) {
        skip = parsedSkip;
      }
    }

    if (req.query.$top) {
      const parsedTop = parseInt(String(req.query.$top), 10);
      if (!isNaN(parsedTop) && parsedTop >= 0) {
        top = parsedTop;
      }
    }
  }

  // Cap top at maximum
  top = Math.min(top, PAGINATION.MAX_PAGE_SIZE);

  query.$skip = skip;
  query.$top = top;

  // $select - comma-separated list of properties
  if (req.query.$select && !query.$select) {
    query.$select = String(req.query.$select).split(',').map(s => s.trim());
  }

  // $expand - comma-separated list of navigation properties
  if (req.query.$expand && !query.$expand) {
    query.$expand = String(req.query.$expand).split(',').map(s => s.trim());
  }

  // $filter - filter expression (stored as string, parsing delegated to consumers)
  if (req.query.$filter && !query.$filter) {
    query.$filter = String(req.query.$filter);
  }

  // $orderby - sort expression
  if (req.query.$orderby && !query.$orderby) {
    query.$orderby = String(req.query.$orderby);
  }

  // $count - include count of total results
  if (req.query.$count) {
    query.$count = String(req.query.$count).toLowerCase() === 'true';
  }

  // $search - full-text search
  if (req.query.$search) {
    query.$search = String(req.query.$search);
  }

  return query;
}

/**
 * Format response data as OData collection
 */
export function formatODataResponse<T>(
  data: T[],
  context: string,
  options?: {
    count?: number;
    nextLink?: string;
  }
): ODataResponse<T> {
  const response: ODataResponse<T> = {
    '@odata.context': context,
    value: data
  };

  if (options?.count !== undefined) {
    response['@odata.count'] = options.count;
  }

  if (options?.nextLink) {
    response['@odata.nextLink'] = options.nextLink;
  }

  return response;
}

/**
 * Middleware to parse OData query parameters and attach to request
 */
export function odataMiddleware(req: Request, res: Response, next: NextFunction): void {
  (req as any).odata = parseODataQuery(req);
  next();
}

/**
 * Apply $select to filter object properties
 */
export function applySelect<T extends Record<string, any>>(
  obj: T,
  select?: string[]
): Partial<T> {
  if (!select || select.length === 0) {
    return obj;
  }

  const result: any = {};
  for (const key of select) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Apply $top and $skip to array
 */
export function applyPagination<T>(
  items: T[],
  top?: number,
  skip?: number
): T[] {
  let result = items;

  if (skip !== undefined && skip > 0) {
    result = result.slice(skip);
  }

  if (top !== undefined && top >= 0) {
    result = result.slice(0, top);
  }

  return result;
}

/**
 * Format a paginated OData response with proper @odata.nextLink and @odata.count
 */
export function formatPaginatedResponse<T>(
  items: T[],
  totalCount: number,
  req: Request,
  odataQuery: ODataQuery
): ODataResponse<T> {
  const { $top = PAGINATION.DEFAULT_PAGE_SIZE, $skip = 0, $count } = odataQuery;
  const hasMore = $skip + items.length < totalCount;

  // Use baseUrl + path to get full route path
  const fullPath = (req.baseUrl || '') + req.path;

  const response: ODataResponse<T> = {
    '@odata.context': `https://graph.microsoft.com/v1.0/$metadata#${getContextType(fullPath)}`,
    value: items
  };

  // Include count if requested
  if ($count) {
    response['@odata.count'] = totalCount;
  }

  // Include nextLink if more results exist
  if (hasMore) {
    response['@odata.nextLink'] = generateNextLink(
      `${req.protocol}://${req.get('host')}`,
      fullPath,
      $skip,
      $top,
      {
        filter: odataQuery.$filter,
        orderBy: odataQuery.$orderby,
        select: odataQuery.$select?.join(','),
        expand: odataQuery.$expand?.join(',')
      }
    );
  }

  return response;
}

/**
 * Helper to derive context type from request path
 */
function getContextType(path: string): string {
  if (path.includes('/children')) return 'driveItems';
  if (path.includes('/items')) return 'listItems';
  if (path.includes('/drives')) return 'drives';
  if (path.includes('/lists') && !path.includes('/items')) return 'lists';
  if (path.includes('/sites')) return 'sites';
  return 'Collection';
}
