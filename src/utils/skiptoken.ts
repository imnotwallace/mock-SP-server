/**
 * Skiptoken payload for pagination state
 */
export interface SkipTokenPayload {
  skip: number;
  top?: number;
  orderBy?: string;
  filter?: string;
  select?: string;
  expand?: string;
}

/**
 * Encode pagination state into a base64url skiptoken
 */
export function encodeSkipToken(payload: SkipTokenPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json).toString('base64url');
}

/**
 * Decode a base64url skiptoken into pagination state
 * Returns null if token is invalid
 */
export function decodeSkipToken(token: string): SkipTokenPayload | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    return JSON.parse(decoded) as SkipTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Generate a nextLink URL with encoded skiptoken
 */
export function generateNextLink(
  baseUrl: string,
  path: string,
  currentSkip: number,
  pageSize: number,
  queryParams: {
    filter?: string;
    orderBy?: string;
    select?: string;
    expand?: string;
  }
): string {
  const nextPayload: SkipTokenPayload = {
    skip: currentSkip + pageSize,
    top: pageSize
  };

  // Include query params in skiptoken to preserve them
  if (queryParams.filter) {
    nextPayload.filter = queryParams.filter;
  }
  if (queryParams.orderBy) {
    nextPayload.orderBy = queryParams.orderBy;
  }
  if (queryParams.select) {
    nextPayload.select = queryParams.select;
  }
  if (queryParams.expand) {
    nextPayload.expand = queryParams.expand;
  }

  const skiptoken = encodeSkipToken(nextPayload);
  return `${baseUrl}${path}?$skiptoken=${skiptoken}`;
}
