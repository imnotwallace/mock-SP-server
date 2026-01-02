import { Router, Request, Response, NextFunction } from 'express';
import { SearchService } from '../services/search.js';
import { GraphError } from '../middleware/error.js';
import { ServerContext } from '../server.js';

/**
 * Create search router
 */
export function createSearchRouter(ctx: ServerContext): Router {
  const router = Router();
  const { db } = ctx;

  /**
   * POST /search/query
   * Microsoft Search API endpoint
   */
  router.post('/query', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { requests } = req.body;

      if (!requests || !Array.isArray(requests)) {
        throw GraphError.badRequest('requests array is required');
      }

      const searchService = new SearchService(db);
      const results = [];

      for (const request of requests) {
        const { entityTypes, query, from, size, fields } = request;

        if (!entityTypes || query?.queryString === undefined || query?.queryString === null) {
          throw GraphError.badRequest('entityTypes and query.queryString are required');
        }

        // Validate entity types
        const validTypes = ['driveItem', 'listItem', 'list', 'site'];
        for (const type of entityTypes) {
          if (!validTypes.includes(type)) {
            throw GraphError.badRequest(`Invalid entity type: ${type}`);
          }
        }

        // Execute search
        const result = await searchService.search({
          queryString: query.queryString,
          entityTypes,
          from: from || 0,
          size: Math.min(size || 25, 200), // Cap at 200
          fields
        });

        results.push(result);
      }

      res.json({ value: results });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
