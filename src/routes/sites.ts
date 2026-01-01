import { Router, Request, Response, NextFunction } from 'express';
import { formatODataResponse, applySelect, applyPagination, ODataQuery } from '../middleware/odata.js';
import { GraphError } from '../middleware/error.js';
import { ServerContext } from '../server.js';

/**
 * Create router for /v1.0/sites endpoints
 */
export function createSitesRouter(ctx: ServerContext): Router {
  const router = Router();
  const { db } = ctx;

  // GET /v1.0/sites - List all site collections
  router.get('/', (req: Request, res: Response) => {
    const odata = (req as any).odata as ODataQuery;
    let siteCollections = db.getItemsByType('siteCollection');

    // Apply pagination
    siteCollections = applyPagination(siteCollections, odata.$top, odata.$skip);

    // Apply select
    let value = siteCollections.map(sc => applySelect(sc, odata.$select));

    const response = formatODataResponse(
      value,
      'https://graph.microsoft.com/v1.0/$metadata#sites'
    );

    res.json(response);
  });

  // GET /v1.0/sites/:siteId - Get site by ID
  router.get('/:siteId', (req: Request, res: Response, next: NextFunction) => {
    const { siteId } = req.params;
    const item = db.getItemById(siteId);

    if (!item || (item.type !== 'siteCollection' && item.type !== 'site')) {
      return next(GraphError.notFound(`Site with ID '${siteId}' not found`));
    }

    res.json(item);
  });

  // GET /v1.0/sites/:siteId/sites - Get subsites
  router.get('/:siteId/sites', (req: Request, res: Response, next: NextFunction) => {
    const { siteId } = req.params;
    const odata = (req as any).odata as ODataQuery;

    // Verify parent site exists
    const parentSite = db.getItemById(siteId);
    if (!parentSite || (parentSite.type !== 'siteCollection' && parentSite.type !== 'site')) {
      return next(GraphError.notFound(`Site with ID '${siteId}' not found`));
    }

    // Get all child items and filter by type='site'
    let subsites = db.getItemsByParent(siteId).filter(item => item.type === 'site');

    // Apply pagination
    subsites = applyPagination(subsites, odata.$top, odata.$skip);

    // Apply select
    let value = subsites.map(site => applySelect(site, odata.$select));

    const response = formatODataResponse(
      value,
      'https://graph.microsoft.com/v1.0/$metadata#sites'
    );

    res.json(response);
  });

  return router;
}
