import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export type Role = 'AUTHOR' | 'ADMIN';
export interface AuthUser { id: string; role: Role; name: string; email: string; authorId: string | null }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser } }
}

export const TOKEN_COOKIE = 'bl_token';
const TOKEN_TTL = '12h';

export const signToken = (u: AuthUser) =>
  jwt.sign({ sub: u.id, role: u.role, name: u.name, email: u.email, authorId: u.authorId }, env.JWT_SECRET, { expiresIn: TOKEN_TTL });

/**
 * Accepts the JWT from (in order): Authorization: Bearer header, httpOnly cookie,
 * or `?token=` query param — the last one only because EventSource (SSE) cannot set headers.
 */
function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies?.[TOKEN_COOKIE]) return req.cookies[TOKEN_COOKIE];
  if (typeof req.query.token === 'string' && req.path.endsWith('/stream')) return req.query.token;
  return undefined;
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return next(AppError.unauthorized());
  try {
    const p = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    req.user = { id: p.sub!, role: p.role, name: p.name, email: p.email, authorId: p.authorId ?? null };
    next();
  } catch {
    next(AppError.unauthorized('Session expired or invalid token — please log in again'));
  }
}

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(AppError.unauthorized());
  if (!roles.includes(req.user.role)) return next(AppError.forbidden());
  next();
};

/** Narrowing helper for author-only handlers. */
export function currentAuthorId(req: Request): string {
  if (!req.user?.authorId) throw AppError.forbidden('Author account required');
  return req.user.authorId;
}
