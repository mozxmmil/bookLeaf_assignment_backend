import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import { isProd } from '../config/env.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError('NOT_FOUND', `Route ${req.method} ${req.path} not found`));
}

/** Single place that turns errors into the `{ error: { code, message, details } }` envelope. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  // Malformed JSON body from express.json()
  if (err && typeof err === 'object' && (err as any).type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON' } });
  }
  console.error(`[error] ${req.method} ${req.path}`, err);
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.', details: isProd ? undefined : String(err) },
  });
}
