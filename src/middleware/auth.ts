import { Request, Response, NextFunction } from 'express';
import { AuthConfig } from '../config/index.js';
import { GraphError } from './error.js';

/**
 * Store for OAuth tokens
 */
const oauthTokens = new Set<string>();

/**
 * Register an OAuth token
 */
export function registerOAuthToken(token: string): void {
  oauthTokens.add(token);
}

/**
 * Revoke an OAuth token
 */
export function revokeOAuthToken(token: string): void {
  oauthTokens.delete(token);
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Check if path should skip authentication
 */
function shouldSkipAuth(path: string): boolean {
  return path === '/health' || path.startsWith('/oauth/');
}

/**
 * Create authentication middleware based on auth configuration
 */
export function createAuthMiddleware(authConfig: AuthConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip authentication for health check and OAuth endpoints
    if (shouldSkipAuth(req.path)) {
      return next();
    }

    // Mode: none - allow all requests
    if (authConfig.mode === 'none') {
      return next();
    }

    // Extract token from request
    const token = extractBearerToken(req);

    // Mode: static - validate against configured tokens
    if (authConfig.mode === 'static') {
      if (!token) {
        throw GraphError.unauthorized('Missing authentication token');
      }

      const validTokens = authConfig.tokens || [];
      if (!validTokens.includes(token)) {
        throw GraphError.unauthorized('Invalid authentication token');
      }

      return next();
    }

    // Mode: oauth - validate against registered OAuth tokens
    if (authConfig.mode === 'oauth') {
      if (!token) {
        throw GraphError.unauthorized('Missing authentication token');
      }

      if (!oauthTokens.has(token)) {
        throw GraphError.unauthorized('Invalid or expired authentication token');
      }

      return next();
    }

    // Unknown auth mode
    throw GraphError.internal('Invalid authentication configuration');
  };
}
