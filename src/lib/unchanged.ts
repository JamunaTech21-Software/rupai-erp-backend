import { AppError } from './errors.js';

/**
 * An edit that changes nothing is refused (no approval request, no edit-log entry): the form's values are
 * compared with the saved record. Values are compared as saved: dates as their instant ("YYYY-MM-DD" is
 * that day at 00:00 UTC, as the forms save it), decimals as numbers, objects with their keys in order.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isDecimal = (v: object): v is { toNumber(): number } =>
  typeof (v as { toNumber?: unknown }).toNumber === 'function' &&
  typeof (v as { toFixed?: unknown }).toFixed === 'function';

function comparable(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return DAY.test(value) ? `${value}T00:00:00.000Z` : value;
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(comparable);
  if (typeof value === 'object') {
    if (isDecimal(value)) return value.toNumber();
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, comparable(v)]),
    );
  }
  return value;
}

export const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));

/** True when every field of `next` already has that value in `saved`. */
export const sameFields = (
  next: Record<string, unknown>,
  saved: Record<string, unknown> | null | undefined,
) => !!saved && Object.entries(next).every(([key, value]) => sameValue(value, saved[key]));

/** True when `next` rows are the saved rows, in the same order (each compared on the fields sent). */
export const sameRows = (next: Record<string, unknown>[], saved: Record<string, unknown>[]) =>
  next.length === saved.length && next.every((row, i) => sameFields(row, saved[i]));

export const NO_CHANGES = 'There are no changes to save.';
export const noChangesError = () => new AppError('VALIDATION', NO_CHANGES);
