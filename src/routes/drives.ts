import { Router, Request, Response, NextFunction } from 'express';
import { formatODataResponse, applySelect, applyPagination, ODataQuery } from '../middleware/odata.js';
import { GraphError } from '../middleware/error.js';
import { ServerContext } from '../server.js';

/**
 * Create router for /v1.0/sites/:siteId/drives endpoints
 */
export function createDrivesRouter(ctx: ServerContext): Router {
  const router = Router({ mergeParams: true });
  const { db } = ctx;

  // GET /v1.0/sites/:siteId/drives - List all drives (libraries) in a site
  router.get('/', (req: Request, res: Response, next: NextFunction) => {
    const { siteId } = req.params;
    const odata = (req as any).odata as ODataQuery;

    // Verify site exists
    const site = db.getItemById(siteId);
    if (!site || (site.type !== 'siteCollection' && site.type !== 'site')) {
      return next(GraphError.notFound(`Site with ID '${siteId}' not found`));
    }

    // Get all libraries (drives) for this site
    let drives = db.getItemsByParent(siteId).filter(item => item.type === 'library');

    // Apply pagination
    drives = applyPagination(drives, odata.$top, odata.$skip);

    // Apply select
    let value = drives.map(drive => applySelect(drive, odata.$select));

    const response = formatODataResponse(
      value,
      'https://graph.microsoft.com/v1.0/$metadata#drives'
    );

    res.json(response);
  });

  // GET /v1.0/sites/:siteId/drives/drive - Get default drive for a site
  router.get('/drive', (req: Request, res: Response, next: NextFunction) => {
    const { siteId } = req.params;

    // Verify site exists
    const site = db.getItemById(siteId);
    if (!site || (site.type !== 'siteCollection' && site.type !== 'site')) {
      return next(GraphError.notFound(`Site with ID '${siteId}' not found`));
    }

    // Get first library as default drive
    const drives = db.getItemsByParent(siteId).filter(item => item.type === 'library');
    if (drives.length === 0) {
      return next(GraphError.notFound(`No drives found for site '${siteId}'`));
    }

    res.json(drives[0]);
  });

  return router;
}

/**
 * Create router for /v1.0/drives/:driveId/... endpoints
 */
export function createDriveItemsRouter(ctx: ServerContext): Router {
  const router = Router();
  const { db, fsService } = ctx;

  // GET /v1.0/drives/:driveId/root/children - List root folder contents
  router.get('/:driveId/root/children', (req: Request, res: Response, next: NextFunction) => {
    const { driveId } = req.params;
    const odata = (req as any).odata as ODataQuery;

    // Verify drive exists
    const drive = db.getItemById(driveId);
    if (!drive || drive.type !== 'library') {
      return next(GraphError.notFound(`Drive with ID '${driveId}' not found`));
    }

    // Get children of the drive (root level items)
    let children = db.getItemsByParent(driveId);

    // Apply pagination
    children = applyPagination(children, odata.$top, odata.$skip);

    // Apply select
    let value = children.map(item => applySelect(item, odata.$select));

    const response = formatODataResponse(
      value,
      'https://graph.microsoft.com/v1.0/$metadata#driveItems'
    );

    res.json(response);
  });

  // GET /v1.0/drives/:driveId/items/:itemId - Get item by ID
  router.get('/:driveId/items/:itemId', (req: Request, res: Response, next: NextFunction) => {
    const { driveId, itemId } = req.params;

    // Verify drive exists
    const drive = db.getItemById(driveId);
    if (!drive || drive.type !== 'library') {
      return next(GraphError.notFound(`Drive with ID '${driveId}' not found`));
    }

    // Get the item
    const item = db.getItemById(itemId);
    if (!item) {
      return next(GraphError.notFound(`Item with ID '${itemId}' not found`));
    }

    res.json(item);
  });

  // GET /v1.0/drives/:driveId/items/:itemId/children - Get folder contents
  router.get('/:driveId/items/:itemId/children', (req: Request, res: Response, next: NextFunction) => {
    const { driveId, itemId } = req.params;
    const odata = (req as any).odata as ODataQuery;

    // Verify drive exists
    const drive = db.getItemById(driveId);
    if (!drive || drive.type !== 'library') {
      return next(GraphError.notFound(`Drive with ID '${driveId}' not found`));
    }

    // Get the parent item
    const parentItem = db.getItemById(itemId);
    if (!parentItem) {
      return next(GraphError.notFound(`Item with ID '${itemId}' not found`));
    }

    // Get children
    let children = db.getItemsByParent(itemId);

    // Apply pagination
    children = applyPagination(children, odata.$top, odata.$skip);

    // Apply select
    let value = children.map(item => applySelect(item, odata.$select));

    const response = formatODataResponse(
      value,
      'https://graph.microsoft.com/v1.0/$metadata#driveItems'
    );

    res.json(response);
  });

  // GET /v1.0/drives/:driveId/items/:itemId/content - Download file
  router.get('/:driveId/items/:itemId/content', (req: Request, res: Response, next: NextFunction) => {
    const { driveId, itemId } = req.params;

    // Verify drive exists
    const drive = db.getItemById(driveId);
    if (!drive || drive.type !== 'library') {
      return next(GraphError.notFound(`Drive with ID '${driveId}' not found`));
    }

    // Get the item
    const item = db.getItemById(itemId);
    if (!item) {
      return next(GraphError.notFound(`Item with ID '${itemId}' not found`));
    }

    if (item.type !== 'file') {
      return next(GraphError.badRequest(`Item '${itemId}' is not a file`));
    }

    // Read file content
    try {
      const content = fsService.readFile(item.path);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${item.name}"`);
      res.send(content);
    } catch (error) {
      return next(GraphError.notFound(`File content not found for item '${itemId}'`));
    }
  });

  // PUT /v1.0/drives/:driveId/items/:itemId/content - Upload file
  router.put('/:driveId/items/:itemId/content', (req: Request, res: Response, next: NextFunction) => {
    const { driveId, itemId } = req.params;

    // Verify drive exists
    const drive = db.getItemById(driveId);
    if (!drive || drive.type !== 'library') {
      return next(GraphError.notFound(`Drive with ID '${driveId}' not found`));
    }

    // Get the item
    const item = db.getItemById(itemId);
    if (!item) {
      return next(GraphError.notFound(`Item with ID '${itemId}' not found`));
    }

    if (item.type !== 'file') {
      return next(GraphError.badRequest(`Item '${itemId}' is not a file`));
    }

    // Get content from request body
    let content: Buffer;
    if (Buffer.isBuffer(req.body)) {
      content = req.body;
    } else if (typeof req.body === 'string') {
      content = Buffer.from(req.body, 'utf-8');
    } else {
      content = Buffer.from(JSON.stringify(req.body), 'utf-8');
    }

    // Write file content
    try {
      fsService.writeFile(item.path, content);

      // Update item metadata
      const updatedItem = {
        ...item,
        modifiedAt: new Date().toISOString(),
        size: content.length
      };
      db.upsertItem(updatedItem);

      res.json(updatedItem);
    } catch (error) {
      return next(GraphError.internalError(`Failed to upload file: ${error}`));
    }
  });

  // DELETE /v1.0/drives/:driveId/items/:itemId - Delete item
  router.delete('/:driveId/items/:itemId', (req: Request, res: Response, next: NextFunction) => {
    const { driveId, itemId } = req.params;

    // Verify drive exists
    const drive = db.getItemById(driveId);
    if (!drive || drive.type !== 'library') {
      return next(GraphError.notFound(`Drive with ID '${driveId}' not found`));
    }

    // Get the item
    const item = db.getItemById(itemId);
    if (!item) {
      return next(GraphError.notFound(`Item with ID '${itemId}' not found`));
    }

    // Delete file from filesystem if it's a file
    if (item.type === 'file') {
      try {
        fsService.deleteFile(item.path);
      } catch (error) {
        // Continue even if file doesn't exist on disk
      }
    }

    // Delete from database
    db.deleteItem(itemId);

    res.status(204).send();
  });

  return router;
}
