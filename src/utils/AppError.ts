export type ErrorCode =
  | 'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'CONFLICT' | 'AI_UNAVAILABLE' | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  CONFLICT: 409, AI_UNAVAILABLE: 503, INTERNAL: 500,
};

/** Operational error with a stable machine-readable code. Anything else is treated as a 500. */
export class AppError extends Error {
  readonly status: number;
  constructor(public readonly code: ErrorCode, message: string, public readonly details?: unknown) {
    super(message);
    this.status = STATUS[code];
  }
  static notFound(what = 'Resource') { return new AppError('NOT_FOUND', `${what} not found`); }
  static unauthorized(msg = 'Authentication required') { return new AppError('UNAUTHORIZED', msg); }
  static forbidden(msg = 'You do not have access to this resource') { return new AppError('FORBIDDEN', msg); }
}
