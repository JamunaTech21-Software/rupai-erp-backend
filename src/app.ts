import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';

import { corsOrigins } from './config/env.js';
import { buildOpenApi } from './docs/openapi.js';
import './lib/validation.js';
import { db } from './lib/db.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { api } from './routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // API docs (RP1-11): before helmet, whose content security policy would block the docs page's script.
  app.get('/docs.json', (_req, res) => {
    res.json(buildOpenApi());
  });
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(undefined, { swaggerOptions: { url: '/docs.json', persistAuthorization: true } }),
  );

  app.use(helmet());
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

  app.get('/health', async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', database: 'ok' });
    } catch {
      res.status(503).json({ status: 'error', database: 'unreachable' });
    }
  });

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
