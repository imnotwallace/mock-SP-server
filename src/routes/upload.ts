import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import { GraphError } from '../middleware/error.js';
import { ServerContext } from '../server.js';
import { UploadSessionService } from '../services/upload-session.js';
import { EnhancedDriveItem } from '../types/index.js';
import { getMimeType } from '../utils/index.js';

/**
 * Format drive item for response
 */
function formatDriveItem(item: any, db: any, serverHost: string): EnhancedDriveItem {
  const enhanced: EnhancedDriveItem = {
    id: item.id,
    name: item.name,
    createdDateTime: item.createdAt,
    lastModifiedDateTime: item.modifiedAt,
  };

  if (item.size !== undefined) {
    enhanced.size = item.size;
  }

  if (item.type === 'file') {
    enhanced.file = {
      mimeType: getMimeType(item.name)
    };
    enhanced.webUrl = `${serverHost}/${item.path}`;
  }

  if (item.type === 'folder') {
    const children = db.getItemsByParent(item.id);
    enhanced.folder = { childCount: children.length };
  }

  // Get field values
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

  return enhanced;
}

/**
 * Create upload router
 */
export function createUploadRouter(ctx: ServerContext): Router {
  const router = Router();
  const serverHost = 'http://localhost:5001'; // TODO: Get from config

  // Create upload session service instance
  const uploadService = new UploadSessionService(ctx.db, ctx.fsService, serverHost);

  // Apply raw body parser to all routes on this router
  router.use(express.raw({
    type: '*/*',
    limit: '64mb'
  }));

  // PUT /upload/sessions/:sessionId - Upload bytes to session
  router.put('/sessions/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;
      const contentRange = req.get('Content-Range');

      if (!contentRange) {
        throw GraphError.badRequest('Content-Range header is required');
      }

      // Ensure we have a Buffer
      let content: Buffer;
      if (Buffer.isBuffer(req.body)) {
        content = req.body;
      } else if (typeof req.body === 'string') {
        content = Buffer.from(req.body, 'binary');
      } else {
        throw GraphError.badRequest('Invalid request body - expected binary data');
      }

      const result = await uploadService.uploadBytes(
        sessionId,
        content,
        contentRange
      );

      if (result.item) {
        // Upload complete - return the created item
        const formattedItem = formatDriveItem(result.item, ctx.db, serverHost);
        res.status(201).json(formattedItem);
      } else if (result.session) {
        // More bytes expected - return session status
        res.status(202).json(result.session);
      } else {
        throw GraphError.internal('Invalid upload result');
      }
    } catch (error) {
      next(error);
    }
  });

  // GET /upload/sessions/:sessionId - Get session status
  router.get('/sessions/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;

      const session = await uploadService.getSessionStatus(sessionId);
      if (!session) {
        throw GraphError.notFound('Upload session not found or expired');
      }

      res.json(session);
    } catch (error) {
      next(error);
    }
  });

  // DELETE /upload/sessions/:sessionId - Cancel session
  router.delete('/sessions/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;

      await uploadService.cancelSession(sessionId);

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
