import { Request, Response, NextFunction } from 'express';

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

  // $select - comma-separated list of properties
  if (req.query.$select) {
    query.$select = String(req.query.$select).split(',').map(s => s.trim());
  }

  // $expand - comma-separated list of navigation properties
  if (req.query.$expand) {
    query.$expand = String(req.query.$expand).split(',').map(s => s.trim());
  }

  // $filter - filter expression (stored as string, parsing delegated to consumers)
  if (req.query.$filter) {
    query.$filter = String(req.query.$filter);
  }

  // $orderby - sort expression
  if (req.query.$orderby) {
    query.$orderby = String(req.query.$orderby);
  }

  // $top - max number of results
  if (req.query.$top) {
    const top = parseInt(String(req.query.$top), 10);
    if (!isNaN(top) && top >= 0) {
      query.$top = top;
    }
  }

  // $skip - number of results to skip
  if (req.query.$skip) {
    const skip = parseInt(String(req.query.$skip), 10);
    if (!isNaN(skip) && skip >= 0) {
      query.$skip = skip;
    }
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

  if (top !== undefined && top > 0) {
    result = result.slice(0, top);
  }

  return result;
}
