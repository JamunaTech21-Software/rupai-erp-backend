/** Counting helpers for the HR list pages' cards and overviews (employees, workers, contractors). */
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const pct = (n: number, total: number) => (total ? round2((n / total) * 100) : 0);
/** `on-leave` → `On Leave`. */
export const label = (v: string) =>
  v
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** Counts by a field, largest first, with the share of the total. */
export function countBy<T>(rows: T[], key: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count], i) => ({
      id: i + 1,
      value,
      name: label(value),
      count,
      percentage: pct(count, rows.length),
    }));
}

/** Whole years between two dates. */
export const yearsBetween = (from: Date, to: Date) => {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  if (
    to.getUTCMonth() < from.getUTCMonth() ||
    (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() < from.getUTCDate())
  )
    years -= 1;
  return years;
};

/** How many rows fall in each [min, max) band. */
export function bands<T>(rows: T[], value: (row: T) => number, ranges: [string, number, number][]) {
  return ranges.map(([bandLabel, min, max]) => {
    const n = rows.filter((r) => value(r) >= min && value(r) < max).length;
    return { label: bandLabel, value: n, percentage: pct(n, rows.length) };
  });
}

/** True when the date falls in the current calendar month. */
export const inThisMonth = (date: Date, now = new Date()) =>
  date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth();
