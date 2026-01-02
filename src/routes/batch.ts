import { Router, Application } from 'express';
import { BatchService, BatchRequest } from '../services/batch.js';
import { GraphError } from '../middleware/error.js';

/**
 * Create batch router for handling /$batch endpoint
 */
export function createBatchRouter(app: Application): Router {
  const router = Router();
  const batchService = new BatchService(app);

  /**
   * POST /$batch
   * Execute multiple API requests in a single batch
   */
  router.post('/', async (req, res) => {
    const { requests } = req.body;

    // Validate requests array exists
    if (!requests || !Array.isArray(requests)) {
      throw GraphError.badRequest('requests array is required');
    }

    // Validate each request has required fields
    for (const request of requests) {
      if (!request.id || !request.method || !request.url) {
        throw GraphError.badRequest('Each request must have id, method, and url');
      }

      // Validate HTTP method
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        throw GraphError.badRequest(`Invalid method: ${request.method}`);
      }
    }

    // Process batch
    const responses = await batchService.processBatch(
      requests as BatchRequest[],
      req.get('Authorization')
    );

    // Return batch response
    res.json({ responses });
  });

  return router;
}
