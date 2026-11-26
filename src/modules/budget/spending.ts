import { db } from '../../lib/db.js';

/**
 * RP1-249 / RP1-255 actual expense and commitment per estate, financial year, department and head, for the budget
 * pages and reports. Source: Expense Entry (`budget_expenses`, B.7): Actual = actual expenses (and commitments
 * marked Paid); Commitment = open commitments (PO / PR).
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

/** Actual and commitment by estate, financial year, department and head. */
export async function spending(
  estate: string,
  financialYear: string,
  exclude?: string,
): Promise<Map<string, Spent>> {
  const rows = await db.budgetExpense.groupBy({
    by: ['department', 'head', 'type'],
    where: { estate, financialYear, deletedAt: null, ...(exclude ? { NOT: { id: exclude } } : {}) },
    _sum: { amount: true },
  });
  const map = new Map<string, Spent>();
  for (const r of rows) {
    const key = keyOf({ estate, financialYear, department: r.department, head: r.head });
    const s = map.get(key) ?? { actual: 0, commitment: 0 };
    const v = Number(r._sum.amount ?? 0);
    if (r.type === 'COMMITMENT') s.commitment += v;
    else s.actual += v;
    map.set(key, s);
  }
  return map;
}
export const spentOf = (map: Map<string, Spent>, k: SpendKey): Spent =>
  map.get(keyOf(k)) ?? { actual: 0, commitment: 0 };
