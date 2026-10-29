import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { env } from './config/env.js';
import { authenticate, requireRole } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { booksRouter } from './modules/books/books.routes.js';
import { ticketsRouter } from './modules/tickets/tickets.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { sseHandler } from './realtime/sse.js';
import { aiEnabled } from './ai/aiService.js';

export function createApp() {
  const app = express();
  const origins = env.CLIENT_ORIGIN.split(',').map((o) => o.trim());

  app.set('trust proxy', 1);
  app.use(cors({ origin: origins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', ai: aiEnabled() ? 'enabled' : 'disabled (manual mode)' }));

  const specPath = path.resolve(process.cwd(), 'openapi.yaml');
  if (fs.existsSync(specPath)) {
    const spec = YAML.parse(fs.readFileSync(specPath, 'utf8'));
    app.get('/api/openapi.json', (_req, res) => res.json(spec));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'BookLeaf API' }));
  }

  // Public
  app.use('/api/v1/auth', authRouter);

  // Everything below requires a valid token
  app.get('/api/v1/stream', authenticate, sseHandler);
  app.use('/api/v1/books', authenticate, requireRole('AUTHOR'), booksRouter);
  app.use('/api/v1/tickets', authenticate, requireRole('AUTHOR'), ticketsRouter);
  app.use('/api/v1/admin', authenticate, requireRole('ADMIN'), adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
