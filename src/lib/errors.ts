/**
 * The API's error answer (plan.md §3): `{ error: { code, message, fields? } }`. `fields` is keyed by the
 * form field name, so the dashboard can show each message under its field.
 */
export type ErrorCode = 'VALIDATION' | 'UNAUTHENTICATED' | 'NOT_FOUND' | 'DUPLICATE' | 'SERVER_ERROR';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  DUPLICATE: 409,
  SERVER_ERROR: 500,
};

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = 'Record') => new AppError('NOT_FOUND', `${what} not found.`);
export const unauthenticated = (message = 'Please sign in.') => new AppError('UNAUTHENTICATED', message);
