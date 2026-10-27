import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

import { AppError, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/** zod issues → `{ fieldName: message }`, the first message per field. */
export function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

/** A Prisma unique-constraint failure names the columns; they become the duplicate fields. */
function duplicateFields(error: unknown): Record<string, string> | undefined {
  if (typeof error !== 'object' || error === null || (error as { code?: unknown }).code !== 'P2002') return;
  const meta = (error as { meta?: { target?: unknown } }).meta;
  const target = Array.isArray(meta?.target) ? (meta.target as string[]) : [];
  return Object.fromEntries(target.map((field) => [field, 'This value is already used.']));
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound('Endpoint'));
};

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) },
    });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: 'Please correct the highlighted fields.',
        fields: zodFields(error),
      },
    });
    return;
  }
  const duplicate = duplicateFields(error);
  if (duplicate) {
    res
      .status(409)
      .json({ error: { code: 'DUPLICATE', message: 'This record already exists.', fields: duplicate } });
    return;
  }
  // Malformed JSON body.
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: unknown }).type === 'entity.parse.failed'
  ) {
    res.status(400).json({ error: { code: 'VALIDATION', message: 'The request body is not valid JSON.' } });
    return;
  }
  logger.error({ err: error, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong.' } });
};
