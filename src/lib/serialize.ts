/**
 * Database rows → API JSON (plan.md §3): decimals become numbers, date columns `YYYY-MM-DD`, timestamps
 * ISO strings. The audit columns of deletion stay internal.
 */
const TIMESTAMPS = new Set(['createdAt', 'updatedAt', 'changedAt']);
const HIDDEN = new Set(['deletedAt', 'deletedBy']);

const isDecimal = (v: object): v is { toNumber(): number } =>
  typeof (v as { toNumber?: unknown }).toNumber === 'function' && 'd' in v;

export function toJson(value: unknown, key = ''): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date)
    return TIMESTAMPS.has(key) ? value.toISOString() : value.toISOString().slice(0, 10);
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map((v) => toJson(v));
  if (typeof value === 'object') {
    if (isDecimal(value)) return value.toNumber();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!HIDDEN.has(k)) out[k] = toJson(v, k);
    return out;
  }
  return value;
}
