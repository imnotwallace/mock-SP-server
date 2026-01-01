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

  // Middleware
  app.use(express.json());
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

      // Create server context
      const ctx: ServerContext = { db, fsService };

      // OAuth routes (before API routes)
      app.use('/oauth', createAuthRouter());

      // Register routes (after db and fsService are initialized)
      app.use('/v1.0/sites', createSitesRouter(ctx));
      app.use('/v1.0/sites/:siteId/lists', createListsRouter(ctx));
      app.use('/v1.0/sites/:siteId/drives', createDrivesRouter(ctx));
      app.use('/v1.0/drives', createDriveItemsRouter(ctx));

      // 404 handler for unmatched routes
      app.use(notFoundHandler);

      // Error handler (must be last)
      app.use(errorHandler);

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
