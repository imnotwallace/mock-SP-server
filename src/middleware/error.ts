import { Request, Response, NextFunction } from 'express';

/**
 * Microsoft Graph API error response format
 */
export interface GraphErrorResponse {
  error: {
    code: string;
    message: string;
    innerError?: {
      date: string;
      'request-id': string;
      'client-request-id'?: string;
    };
  };
}

/**
 * Custom error class for Graph API errors
 */
export class GraphError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'GraphError';
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Create a 404 Not Found error
   */
  static notFound(message: string = 'Resource not found'): GraphError {
    return new GraphError(404, 'itemNotFound', message);
  }

  /**
   * Create a 400 Bad Request error
   */
  static badRequest(message: string = 'Invalid request'): GraphError {
    return new GraphError(400, 'invalidRequest', message);
  }

  /**
   * Create a 401 Unauthorized error
   */
  static unauthorized(message: string = 'Unauthorized'): GraphError {
    return new GraphError(401, 'unauthenticated', message);
  }

  /**
   * Create a 403 Forbidden error
   */
  static forbidden(message: string = 'Access denied'): GraphError {
    return new GraphError(403, 'accessDenied', message);
  }

  /**
   * Create a 500 Internal Server Error
   */
  static internal(message: string = 'Internal server error'): GraphError {
    return new GraphError(500, 'internalServerError', message);
  }

  /**
   * Convert to Graph API error response format
   */
  toJSON(): GraphErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        innerError: {
          date: new Date().toISOString(),
          'request-id': generateRequestId()
        }
      }
    };
  }
}

/**
 * Generate a mock request ID
 */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Express error handling middleware
 * Converts errors to Graph API error format
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // If response already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(err);
  }

  // Handle GraphError instances
  if (err instanceof GraphError) {
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  // Handle other errors as 500 Internal Server Error
  console.error('Unhandled error:', err);
  const graphError = GraphError.internal(err.message || 'An unexpected error occurred');
  res.status(graphError.statusCode).json(graphError.toJSON());
}

/**
 * 404 Not Found handler for unmatched routes
 */
export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
  const error = GraphError.notFound(`Cannot ${req.method} ${req.path}`);
  res.status(error.statusCode).json(error.toJSON());
}
