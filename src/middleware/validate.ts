import type { Request, Response, NextFunction } from 'express';
import { z, type ZodType } from 'zod';
import { AppError } from '../utils/AppError.js';

type Source = 'body' | 'query' | 'params';

/** Validates and replaces req[source] with the parsed (coerced, stripped) value. */
export const validate = (schema: ZodType, source: Source = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.') || source, message: i.message }));
      return next(new AppError('VALIDATION_ERROR', details[0]?.message ?? 'Invalid request', details));
    }
    // Express 5 makes req.query a getter, so store parsed values on a dedicated property.
    if (source === 'body') req.body = result.data;
    else (req as any).validated = { ...(req as any).validated, [source]: result.data };
    next();
  };

export const idParam = z.object({ id: z.coerce.number().int().positive('Invalid ticket id') });
export const getValidated = <T>(req: Request, source: 'query' | 'params') => (req as any).validated?.[source] as T;
