import { Router, Request, Response, NextFunction } from 'express';
import { formatODataResponse, formatPaginatedResponse, applySelect, applyPagination, ODataQuery } from '../middleware/odata.js';
import { GraphError } from '../middleware/error.js';
import { ServerContext } from '../server.js';
import { generateId, applyFilter } from '../utils/index.js';

/**
 * Create router for /v1.0/sites/:siteId/lists endpoints
 */
export function createListsRouter(ctx: ServerContext): Router {
  const router = Router({ mergeParams: true });
  const { db, fsService } = ctx;

  // GET /v1.0/sites/:siteId/lists - List all lists/libraries in a site
  router.get('/', (req: Request, res: Response, next: NextFunction) => {
    const { siteId } = req.params;
    const odata = (req as any).odata as ODataQuery;

    // Verify parent site exists
    const site = db.getItemById(siteId);
    if (!site || (site.type !== 'site' && site.type !== 'siteCollection')) {
      return next(GraphError.notFound(`Site with ID '${siteId}' not found`));
    }

    // Get all lists and libraries for this site
    let lists = db.getItemsByParent(siteId).filter(
      item => item.type === 'list' || item.type === 'library'
    );

    // Apply $filter if provided
    if (odata.$filter) {
      lists = applyFilter(lists, odata.$filter);
    }

    // Get total count for pagination
    const totalCount = lists.length;

    // Apply pagination
    lists = applyPagination(lists, odata.$top, odata.$skip);

    // Apply select
    let value = lists.map(list => applySelect(list, odata.$select));

    const response = formatPaginatedResponse(
      value,
      totalCount,
      req,
      odata
    );

    res.json(response);
  });

  // GET /v1.0/sites/:siteId/lists/:listId - Get single list
  router.get('/:listId', (req: Request, res: Response, next: NextFunction) => {
    const { siteId, listId } = req.params;

    // Verify parent site exists
    const site = db.getItemById(siteId);
    if (!site || (site.type !== 'site' && site.type !== 'siteCollection')) {
      return next(GraphError.notFound(`Site with ID '${siteId}' not found`));
    }

    // Get the list
    const list = db.getItemById(listId);
    if (!list || (list.type !== 'list' && list.type !== 'library') || list.parentId !== siteId) {
      return next(GraphError.notFound(`List with ID '${listId}' not found`));
    }

    res.json(list);
  });

  // GET /v1.0/sites/:siteId/lists/:listId/items - Get items
  router.get('/:listId/items', (req: Request, res: Response, next: NextFunction) => {
    const { siteId, listId } = req.params;
    const odata = (req as any).odata as ODataQuery;

    // Verify parent site exists
    const site = db.getItemById(siteId);
    if (!site || (site.type !== 'site' && site.type !== 'siteCollection')) {
      return next(GraphError.notFound(`Site with ID '${siteId}' not found`));
    }

    // Get the list
    const list = db.getItemById(listId);
    if (!list || (list.type !== 'list' && list.type !== 'library') || list.parentId !== siteId) {
      return next(GraphError.notFound(`List with ID '${listId}' not found`));
    }

    let items: any[];

    if (list.type === 'library') {
      // For libraries, items are files from the database
      items = db.getItemsByParent(listId);
    } else {
      // For lists, items are in _items.json
      items = fsService.loadListItems(list.path);
    }

    // Apply $filter if provided
    if (odata.$filter) {
      items = applyFilter(items, odata.$filter);
    }

    // Get total count for pagination
    const totalCount = items.length;

    // Apply pagination
    items = applyPagination(items, odata.$top, odata.$skip);

    // Apply select
    let value = items.map(item => applySelect(item, odata.$select));

    const response = formatPaginatedResponse(
      value,
      totalCount,
      req,
      odata
    );

    res.json(response);
  });

  // POST /v1.0/sites/:siteId/lists/:listId/items - Create item
  router.post('/:listId/items', (req: Request, res: Response, next: NextFunction) => {
    const { siteId, listId } = req.params;
    const itemData = req.body;

    // Verify parent site exists
    const site = db.getItemById(siteId);
    if (!site || (site.type !== 'site' && site.type !== 'siteCollection')) {
      return next(GraphError.notFound(`Site with ID '${siteId}' not found`));
    }

    // Get the list
    const list = db.getItemById(listId);
    if (!list || (list.type !== 'list' && list.type !== 'library') || list.parentId !== siteId) {
      return next(GraphError.notFound(`List with ID '${listId}' not found`));
    }

    if (list.type === 'library') {
      return next(GraphError.badRequest('Cannot create items directly in a library. Use drive endpoints for file uploads.'));
    }

    // Generate ID for new item
    const timestamp = Date.now().toString();
    const itemId = generateId(`${list.path}/${timestamp}`);
    const now = new Date().toISOString();

    const newItem = {
      id: itemId,
      ...itemData,
      createdAt: now,
      modifiedAt: now
    };

    // Load existing items, add new one, and save
    const items = fsService.loadListItems(list.path);
    items.push(newItem);
    fsService.saveListItems(list.path, items);

    res.status(201).json(newItem);
  });

  // PATCH /v1.0/sites/:siteId/lists/:listId/items/:itemId - Update item
  router.patch('/:listId/items/:itemId', (req: Request, res: Response, next: NextFunction) => {
    const { siteId, listId, itemId } = req.params;
    const updates = req.body;

    // Verify parent site exists
    const site = db.getItemById(siteId);
    if (!site || (site.type !== 'site' && site.type !== 'siteCollection')) {
      return next(GraphError.notFound(`Site with ID '${siteId}' not found`));
    }

    // Get the list
    const list = db.getItemById(listId);
    if (!list || (list.type !== 'list' && list.type !== 'library') || list.parentId !== siteId) {
      return next(GraphError.notFound(`List with ID '${listId}' not found`));
    }

    if (list.type === 'library') {
      return next(GraphError.badRequest('Cannot update items directly in a library. Use drive endpoints for file operations.'));
    }

    // Load items
    const items = fsService.loadListItems(list.path);
    const itemIndex = items.findIndex((item: any) => item.id === itemId);

    if (itemIndex === -1) {
      return next(GraphError.notFound(`Item with ID '${itemId}' not found`));
    }

    // Update item
    const now = new Date().toISOString();
    items[itemIndex] = {
      ...items[itemIndex],
      ...updates,
      modifiedAt: now
    };

    fsService.saveListItems(list.path, items);

    res.json(items[itemIndex]);
  });

  // DELETE /v1.0/sites/:siteId/lists/:listId/items/:itemId - Delete item
  router.delete('/:listId/items/:itemId', (req: Request, res: Response, next: NextFunction) => {
    const { siteId, listId, itemId } = req.params;

    // Verify parent site exists
    const site = db.getItemById(siteId);
    if (!site || (site.type !== 'site' && site.type !== 'siteCollection')) {
      return next(GraphError.notFound(`Site with ID '${siteId}' not found`));
    }

    // Get the list
    const list = db.getItemById(listId);
    if (!list || (list.type !== 'list' && list.type !== 'library') || list.parentId !== siteId) {
      return next(GraphError.notFound(`List with ID '${listId}' not found`));
    }

    if (list.type === 'library') {
      return next(GraphError.badRequest('Cannot delete items directly in a library. Use drive endpoints for file operations.'));
    }

    // Load items
    const items = fsService.loadListItems(list.path);
    const itemIndex = items.findIndex((item: any) => item.id === itemId);

    if (itemIndex === -1) {
      return next(GraphError.notFound(`Item with ID '${itemId}' not found`));
    }

    // Remove item
    items.splice(itemIndex, 1);
    fsService.saveListItems(list.path, items);

    res.status(204).send();
  });

  return router;
}
