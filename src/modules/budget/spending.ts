/**
 * RP1-249 actual expense and commitment per budget head line, for the budget pages and reports. Their source is
 * Expense Entry (B.7, RP1-255), not built yet, so everything is 0 until then; B.7 fills `spending()` and no page
 * needs to change.
 */
export interface Spent {
  actual: number;
  commitment: number;
}
export interface SpendKey {
  estate: string;
  financialYear: string;
  department: string;
  head: string;
}
export const keyOf = (k: SpendKey) => `${k.estate}|${k.financialYear}|${k.department}|${k.head}`;

/** Actual and commitment by estate, financial year, department and head (all 0 until Expense Entry exists). */
export function spending(_estate: string, _financialYear: string): Promise<Map<string, Spent>> {
  return Promise.resolve(new Map<string, Spent>());
}
export const spentOf = (map: Map<string, Spent>, k: SpendKey): Spent =>
  map.get(keyOf(k)) ?? { actual: 0, commitment: 0 };
