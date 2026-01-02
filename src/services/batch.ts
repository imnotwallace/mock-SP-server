import { Application } from 'express';
import { GraphError } from '../middleware/error.js';

/**
 * Batch request definition
 */
export interface BatchRequest {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: any;
  dependsOn?: string[];
}

/**
 * Batch response definition
 */
export interface BatchResponse {
  id: string;
  status: number;
  headers?: Record<string, string>;
  body?: any;
}

/**
 * Service for processing batch requests
 * Handles multiple API requests in a single HTTP call
 */
export class BatchService {
  private readonly MAX_REQUESTS = 20;

  constructor(private app: Application) {}

  /**
   * Process a batch of requests
   */
  async processBatch(
    requests: BatchRequest[],
    authHeader?: string
  ): Promise<BatchResponse[]> {
    // Validate request count
    if (requests.length > this.MAX_REQUESTS) {
      throw GraphError.badRequest(
        `Batch requests are limited to ${this.MAX_REQUESTS} requests`
      );
    }

    // Validate unique IDs
    const ids = requests.map(r => r.id);
    if (new Set(ids).size !== ids.length) {
      throw GraphError.badRequest('Request IDs must be unique within a batch');
    }

    // Build dependency graph and execution order
    const executionOrder = this.topologicalSort(requests);

    // Execute requests
    const results: Map<string, BatchResponse> = new Map();
    const resolvedValues: Map<string, any> = new Map();

    for (const requestId of executionOrder) {
      const request = requests.find(r => r.id === requestId)!;

      // Resolve URL references (e.g., $1.id)
      const resolvedUrl = this.resolveReferences(request.url, resolvedValues);
      const resolvedBody = request.body
        ? this.resolveReferences(JSON.stringify(request.body), resolvedValues)
        : undefined;

      // Execute internal request
      const headers = { ...request.headers };
      if (authHeader) {
        headers.Authorization = authHeader;
      }
      const response = await this.executeRequest(
        request.method,
        resolvedUrl,
        resolvedBody ? JSON.parse(resolvedBody) : undefined,
        headers
      );

      // Set the response ID
      response.id = requestId;
      results.set(requestId, response);

      // Store response body for reference resolution
      if (response.body) {
        resolvedValues.set(requestId, response.body);
      }
    }

    // Return responses in original order
    return requests.map(r => results.get(r.id)!);
  }

  /**
   * Perform topological sort on requests based on dependencies
   * Uses Kahn's algorithm to detect circular dependencies
   */
  private topologicalSort(requests: BatchRequest[]): string[] {
    const graph: Map<string, string[]> = new Map();
    const inDegree: Map<string, number> = new Map();

    // Initialize graph
    for (const req of requests) {
      graph.set(req.id, []);
      inDegree.set(req.id, 0);
    }

    // Build edges
    for (const req of requests) {
      if (req.dependsOn) {
        for (const dep of req.dependsOn) {
          if (!graph.has(dep)) {
            throw GraphError.badRequest(`Invalid dependency: ${dep}`);
          }
          graph.get(dep)!.push(req.id);
          inDegree.set(req.id, inDegree.get(req.id)! + 1);
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const result: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      for (const neighbor of graph.get(current)!) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (result.length !== requests.length) {
      throw GraphError.badRequest('Circular dependency detected in batch requests');
    }

    return result;
  }

  /**
   * Resolve reference patterns like $1.id in URLs and bodies
   */
  private resolveReferences(
    str: string,
    resolvedValues: Map<string, any>
  ): string {
    // Replace $N.property patterns
    return str.replace(/\$(\d+)\.(\w+)/g, (match, id, prop) => {
      const value = resolvedValues.get(id);
      if (!value) {
        throw GraphError.badRequest(`Reference $${id} not resolved`);
      }
      const resolved = value[prop];
      if (resolved === undefined) {
        throw GraphError.badRequest(`Property ${prop} not found in $${id}`);
      }
      return resolved;
    });
  }

  /**
   * Execute a single request internally through Express
   */
  private async executeRequest(
    method: string,
    url: string,
    body?: any,
    headers?: Record<string, string>
  ): Promise<BatchResponse> {
    return new Promise((resolve) => {
      // Normalize URL
      const normalizedUrl = this.normalizeUrl(url);

      // Create mock request/response objects
      const mockReq = this.createMockRequest(method, normalizedUrl, body, headers);
      const mockRes = this.createMockResponse((status, responseHeaders, responseBody) => {
        resolve({
          id: '', // Will be filled by caller
          status,
          headers: responseHeaders,
          body: responseBody
        });
      });

      // Route through Express (handle is not in Application type but exists at runtime)
      (this.app as any).handle(mockReq, mockRes, (err: any) => {
        if (err) {
          resolve({
            id: '',
            status: err.statusCode || 500,
            body: {
              error: {
                code: err.code || 'internalServerError',
                message: err.message
              }
            }
          });
        }
      });
    });
  }

  /**
   * Normalize URL to handle both absolute and relative URLs
   */
  private normalizeUrl(url: string): string {
    // Handle absolute URLs
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const parsed = new URL(url);
      return parsed.pathname + parsed.search;
    }

    // Handle URLs starting with /
    if (url.startsWith('/')) {
      return url;
    }

    // Relative URLs - assume relative to /v1.0
    return `/v1.0/${url}`;
  }

  /**
   * Create a mock Express request object
   */
  private createMockRequest(
    method: string,
    url: string,
    body?: any,
    headers?: Record<string, string>
  ): any {
    const parsedUrl = new URL(url, 'http://localhost');

    return {
      method,
      url: parsedUrl.pathname + parsedUrl.search,
      path: parsedUrl.pathname,
      query: Object.fromEntries(parsedUrl.searchParams),
      headers: headers || {},
      body,
      get: (name: string) => headers?.[name.toLowerCase()] || headers?.[name],
      header: (name: string) => headers?.[name.toLowerCase()] || headers?.[name],
      // Additional Express request properties
      params: {},
      originalUrl: parsedUrl.pathname + parsedUrl.search,
      baseUrl: '',
      protocol: 'http',
      secure: false,
      ip: '127.0.0.1',
      ips: [],
      hostname: 'localhost'
    };
  }

  /**
   * Create a mock Express response object
   */
  private createMockResponse(
    callback: (status: number, headers: Record<string, string>, body: any) => void
  ): any {
    let statusCode = 200;
    const responseHeaders: Record<string, string> = {};
    let responseBody: any;
    let headersSent = false;

    const self = {
      status: (code: number) => {
        statusCode = code;
        return self;
      },
      set: (name: string | Record<string, string>, value?: string) => {
        if (typeof name === 'object') {
          Object.assign(responseHeaders, name);
        } else if (value !== undefined) {
          responseHeaders[name] = value;
        }
        return self;
      },
      setHeader: (name: string, value: string) => {
        responseHeaders[name] = value;
        return self;
      },
      header: (name: string | Record<string, string>, value?: string) => {
        if (typeof name === 'object') {
          Object.assign(responseHeaders, name);
        } else if (value !== undefined) {
          responseHeaders[name] = value;
        }
        return self;
      },
      get: (name: string) => responseHeaders[name],
      getHeader: (name: string) => responseHeaders[name],
      json: (body: any) => {
        if (!headersSent) {
          responseHeaders['Content-Type'] = 'application/json';
          responseBody = body;
          headersSent = true;
          callback(statusCode, responseHeaders, responseBody);
        }
        return self;
      },
      send: (body: any) => {
        if (!headersSent) {
          responseBody = body;
          headersSent = true;
          callback(statusCode, responseHeaders, responseBody);
        }
        return self;
      },
      end: (data?: any) => {
        if (!headersSent) {
          if (data !== undefined) {
            responseBody = data;
          }
          headersSent = true;
          callback(statusCode, responseHeaders, responseBody);
        }
        return self;
      },
      // Additional Express response properties
      headersSent: false,
      locals: {},
      on: () => self,
      once: () => self,
      emit: () => false,
      removeListener: () => self
    };

    return self;
  }
}
