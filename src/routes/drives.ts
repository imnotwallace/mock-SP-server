import { Router, Request, Response, NextFunction } from 'express';
import { formatODataResponse, applySelect, applyPagination, ODataQuery } from '../middleware/odata.js';
import { GraphError } from '../middleware/error.js';
import { ServerContext } from '../server.js';
import { getMimeType } from '../utils/index.js';
import { EnhancedDriveItem } from '../types/index.js';

/**
 * Build enhanced drive item with Graph API fields
 */
import { ThumbnailService } from '../services/thumbnails.js';
function buildEnhancedItem(
  item: any,
  db: any,
  serverHost: string,
  expand?: string[]
): EnhancedDriveItem {
  const enhanced: EnhancedDriveItem = {
    id: item.id,
    name: item.name,
    createdDateTime: item.createdAt,
    lastModifiedDateTime: item.modifiedAt,
  };

  if (item.size !== undefined) {
    enhanced.size = item.size;
  }

  // Add file object for files
  if (item.type === 'file') {
    enhanced.file = {
      mimeType: getMimeType(item.name)
    };
    enhanced.webUrl = `${serverHost}/${item.path}`;
  }

  // Add folder object for folders
  if (item.type === 'folder') {
    const children = db.getItemsByParent(item.id);
    enhanced.folder = { childCount: children.length };
  }

  // Get field values from database
  const fieldValues = db.getFieldValues(item.id);

  // Build createdBy if available
  const createdByName = fieldValues.find((f: any) => f.fieldName === 'createdBy.displayName');
  const createdByEmail = fieldValues.find((f: any) => f.fieldName === 'createdBy.email');
  if (createdByName || createdByEmail) {
    enhanced.createdBy = {
      user: {
        displayName: createdByName?.fieldValue,
        email: createdByEmail?.fieldValue
      }
    };
  }

  // Build lastModifiedBy if available
  const modifiedByName = fieldValues.find((f: any) => f.fieldName === 'lastModifiedBy.displayName');
  const modifiedByEmail = fieldValues.find((f: any) => f.fieldName === 'lastModifiedBy.email');
  if (modifiedByName || modifiedByEmail) {
    enhanced.lastModifiedBy = {
      user: {
        displayName: modifiedByName?.fieldValue,
        email: modifiedByEmail?.fieldValue
      }
    };
  }

  // Add parentReference
  if (item.parentId) {
    const parent = db.getItemById(item.parentId);
    if (parent) {
      let driveId = item.parentId;
      let current = parent;
      while (current && current.type !== 'library') {
        driveId = current.parentId;
        current = current.parentId ? db.getItemById(current.parentId) : null;
      }

      enhanced.parentReference = {
        driveId: driveId || item.parentId,
        driveType: 'documentLibrary',
        id: item.parentId,
        path: `/drives/${driveId}/root:/${item.path.split('/').slice(-2, -1).join('/')}`
      };
    }
  }

  // Add fields if $expand=fields
  if (expand?.includes('fields')) {
    const fields: Record<string, any> = {};
    for (const fv of fieldValues) {
      if (fv.fieldName.startsWith('fields.')) {
        const fieldName = fv.fieldName.slice(7);
        try {
          fields[fieldName] = JSON.parse(fv.fieldValue);
        } catch {
          fields[fieldName] = fv.fieldValue;
        }
      }
    }
    if (Object.keys(fields).length > 0) {
      enhanced.fields = fields;
    }
  }

  return enhanced;
}

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
  router.get('/:driveId/root/children', async (req: Request, res: Response, next: NextFunction) => {
    const { driveId } = req.params;
    const odata = (req as any).odata as ODataQuery;

    const drive = db.getItemById(driveId);
    if (!drive || drive.type !== 'library') {
      return next(GraphError.notFound(`Drive with ID '${driveId}' not found`));
    }

    let children = db.getItemsByParent(driveId);
    children = applyPagination(children, odata.$top, odata.$skip);

    const serverHost = `${req.protocol}://${req.get('host')}`;
    let value = children.map(item => {
      const enhanced = buildEnhancedItem(item, db, serverHost, odata.$expand);
      return applySelect(enhanced, odata.$select);
    });
    // Expand thumbnails if requested
    if (odata.$expand?.includes('thumbnails')) {
      const thumbnailService = new ThumbnailService(db, fsService.getRootDir());
      const baseUrl = `${serverHost}/v1.0/drives/${driveId}/items`;
      value = await thumbnailService.expandThumbnails(value, baseUrl);
    }


    const response = formatODataResponse(
      value,
      'https://graph.microsoft.com/v1.0/$metadata#driveItems'
    );

    res.json(response);
  });

  // GET /v1.0/drives/:driveId/items/:itemId - Get item by ID
  router.get('/:driveId/items/:itemId', (req: Request, res: Response, next: NextFunction) => {
    const { driveId, itemId } = req.params;
    const odata = (req as any).odata as ODataQuery;

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

    // Build enhanced response
    const serverHost = `${req.protocol}://${req.get('host')}`;
    const enhanced = buildEnhancedItem(item, db, serverHost, odata.$expand);

    res.json(enhanced);
  });

  // GET /v1.0/drives/:driveId/items/:itemId/children - Get folder contents
  router.get('/:driveId/items/:itemId/children', async (req: Request, res: Response, next: NextFunction) => {
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
    // Expand thumbnails if requested
    if (odata.$expand?.includes('thumbnails')) {
      const serverHost = `${req.protocol}://${req.get('host')}`;
      const thumbnailService = new ThumbnailService(db, fsService.getRootDir());
      const baseUrl = `${serverHost}/v1.0/drives/${driveId}/items`;
      value = await thumbnailService.expandThumbnails(value, baseUrl);
    }


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
  router.put('/:driveId/items/:itemId/content', async (req: Request, res: Response, next: NextFunction) => {
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
      // Invalidate thumbnails
      const thumbnailService = new ThumbnailService(db, fsService.getRootDir());
      await thumbnailService.invalidateThumbnails(itemId);

      res.json(updatedItem);
    } catch (error) {
      return next(GraphError.internal(`Failed to upload file: ${error}`));
    }
  });

  // DELETE /v1.0/drives/:driveId/items/:itemId - Delete item
  router.delete('/:driveId/items/:itemId', async (req: Request, res: Response, next: NextFunction) => {
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
    // Invalidate thumbnails
    const thumbnailService = new ThumbnailService(db, fsService.getRootDir());
    await thumbnailService.invalidateThumbnails(itemId);

    res.status(204).send();
  });


  // Thumbnail Routes

  // GET /v1.0/drives/:driveId/items/:itemId/thumbnails
  router.get('/:driveId/items/:itemId/thumbnails', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { itemId } = req.params;

      const item = db.getItemById(itemId);
      if (!item) {
        return next(GraphError.notFound('Item not found'));
      }

      const serverHost = `${req.protocol}://${req.get('host')}`;
      const thumbnailService = new ThumbnailService(db, fsService.getRootDir());
      const baseUrl = `${serverHost}/v1.0/drives/${req.params.driveId}/items/${itemId}`;
      const thumbnails = await thumbnailService.getThumbnails(itemId, baseUrl);

      res.json({
        '@odata.context': `${serverHost}/v1.0/$metadata#thumbnails`,
        value: thumbnails
      });
    } catch (error) {
      next(error);
    }
  });

  // GET /v1.0/drives/:driveId/items/:itemId/thumbnails/:thumbnailId/:size
  router.get('/:driveId/items/:itemId/thumbnails/:thumbnailId/:size', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { itemId, size } = req.params;

      const item = db.getItemById(itemId);
      if (!item) {
        return next(GraphError.notFound('Item not found'));
      }

      const thumbnailService = new ThumbnailService(db, fsService.getRootDir());
      const result = await thumbnailService.getThumbnailContent(itemId, size);

      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(result.content);
    } catch (error) {
      next(error);
    }
  });

  // GET /v1.0/drives/:driveId/items/:itemId/thumbnails/:thumbnailId/:size/content
  router.get('/:driveId/items/:itemId/thumbnails/:thumbnailId/:size/content', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { itemId, size } = req.params;

      const item = db.getItemById(itemId);
      if (!item) {
        return next(GraphError.notFound('Item not found'));
      }

      const thumbnailService = new ThumbnailService(db, fsService.getRootDir());
      const result = await thumbnailService.getThumbnailContent(itemId, size);

      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(result.content);
    } catch (error) {
      next(error);
    }
  });
  return router;
}
