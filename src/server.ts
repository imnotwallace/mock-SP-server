import express, { Express, Request, Response } from 'express';
import { Server } from 'http';
import { MockConfig } from './config/index.js';
import { Database, createDatabase } from './services/database.js';
import { FilesystemService } from './services/filesystem.js';
import { odataMiddleware } from './middleware/odata.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { createSitesRouter } from './routes/sites.js';
import { createListsRouter } from './routes/lists.js';
import { createDrivesRouter, createDriveItemsRouter } from './routes/drives.js';
import { createAuthRouter } from './routes/auth.js';
import { createSearchRouter } from './routes/search.js';
import { createUploadRouter } from './routes/upload.js';
import { createBatchRouter } from './routes/batch.js';
import { createSubscriptionsRouter } from './routes/subscriptions.js';
import { SubscriptionService } from './services/subscriptions.js';

/**
 * Mock SharePoint Server instance
 */
export interface MockServer {
  app: Express;
  start(): Promise<void>;
  stop(): Promise<void>;
  getPort(): number;
}

/**
 * Server context passed to route handlers
 */
export interface ServerContext {
  db: Database;
  fsService: FilesystemService;
}

/**
 * Create and configure Express application for Mock SharePoint Server
 */
export function createMockServer(config: MockConfig): MockServer {
  const app = express();
  let server: Server | null = null;
  let db: Database | null = null;
  let fsService: FilesystemService | null = null;
  let subscriptionService: SubscriptionService | null = null;
  let notificationWorkerInterval: NodeJS.Timeout | null = null;

  // Middleware - skip JSON parsing for /upload routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/upload/sessions')) {
      return next();
    }
    express.json()(req, res, next);
  });
  app.use(express.urlencoded({ extended: true }));
  app.use(express.text());
  app.use(express.raw());

  // Logging middleware (if not in 'error' mode)
  if (config.logging !== 'error') {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
      });
      next();
    });
  }

  // OData middleware
  app.use(odataMiddleware);

  // Authentication middleware (after OData parsing)
  app.use(createAuthMiddleware(config.auth));

  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  });

  // Server lifecycle methods
  const mockServer: MockServer = {
    app,

    async start(): Promise<void> {
      // Initialize database
      db = createDatabase(config.database);

      // Initialize filesystem service
      fsService = new FilesystemService(config.root, db);

      // Initialize subscription service
      subscriptionService = new SubscriptionService(db.raw);

      // Create server context
      const ctx: ServerContext = { db, fsService };

      // OAuth routes (before API routes)
      app.use('/oauth', createAuthRouter());

      // Register routes (after db and fsService are initialized)
      app.use('/v1.0/sites', createSitesRouter(ctx));
      app.use('/v1.0/sites/:siteId/lists', createListsRouter(ctx));
      app.use('/v1.0/sites/:siteId/drives', createDrivesRouter(ctx));
      app.use('/v1.0/drives', createDriveItemsRouter(ctx));
      app.use('/v1.0/search', createSearchRouter(ctx));
      app.use('/upload', createUploadRouter(ctx));
      app.use('/v1.0/subscriptions', createSubscriptionsRouter(subscriptionService));

      // Batch endpoint (must be after other routes so it can route internally)
      app.use('/v1.0/$batch', createBatchRouter(app));
      app.use('/$batch', createBatchRouter(app)); // Also support without version

      // 404 handler for unmatched routes
      app.use(notFoundHandler);

      // Error handler (must be last)
      app.use(errorHandler);

      // Start notification delivery worker
      notificationWorkerInterval = setInterval(async () => {
        try {
          const delivered = await subscriptionService!.deliverPendingNotifications();
          if (delivered > 0 && config.logging !== 'error') {
            console.log(`Delivered ${delivered} notifications`);
          }
        } catch (error) {
          console.error('Notification delivery error:', error);
        }
      }, 5000);

      // Start cleanup worker
      setInterval(() => {
        try {
          const cleaned = subscriptionService!.cleanupExpiredSubscriptions();
          if (cleaned > 0 && config.logging !== 'error') {
            console.log(`Cleaned up ${cleaned} expired subscriptions`);
          }
        } catch (error) {
          console.error('Subscription cleanup error:', error);
        }
      }, 60 * 60 * 1000);

      // Start HTTP server
      return new Promise((resolve, reject) => {
        try {
          server = app.listen(config.port, () => {
            if (config.logging !== 'error') {
              console.log(`Mock SharePoint Server listening on port ${config.port}`);
            }
            resolve();
          });

          server.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'EADDRINUSE') {
              reject(new Error(`Port ${config.port} is already in use`));
            } else {
              reject(error);
            }
          });
        } catch (error) {
          reject(error);
        }
      });
    },

    async stop(): Promise<void> {
      // Stop notification worker
      if (notificationWorkerInterval) {
        clearInterval(notificationWorkerInterval);
        notificationWorkerInterval = null;
      }

      // Clear subscription service
      if (subscriptionService) {
        subscriptionService = null;
      }

      // Close database connection
      if (db) {
        db.close();
        db = null;
      }

      // Clear filesystem service
      if (fsService) {
        fsService = null;
      }

      // Close HTTP server
      if (server) {
        return new Promise((resolve, reject) => {
          server!.close((err) => {
            if (err) {
              reject(err);
            } else {
              server = null;
              resolve();
            }
          });
        });
      }
    },

    getPort(): number {
      return config.port;
    }
  };

  return mockServer;
}
