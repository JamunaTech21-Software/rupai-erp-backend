import type { Tx } from '../../lib/history.js';
import { newId } from '../../lib/ids.js';
import { methodPercents, monthAmounts, round2 } from './budgets.js';
import { headOf } from './heads.js';
import { budgetSettings } from './settings.js';

/** A budget line as read with `include: { lines: true }`. */
interface Line {
  id: string;
  position: number;
  department: string;
  head: string;
  annualAmount: unknown;
  monthPercents: unknown;
}

/**
 * RP1-258 / RP1-261: adds `delta` to one department's head in a budget, in the caller's transaction. The change is
 * spread over the head's lines by their amounts (the last takes the rounding) and each line keeps its monthly %, so
 * the monthly split moves in proportion. A head with no line gets a new one (All Divisions, Settings method).
 * Returns the next free position.
 */
export async function changeHead(
  tx: Tx,
  budget: { id: string; lines: Line[] },
  department: string,
  head: string,
  delta: number,
  fallbackCategory: string,
  position: number,
) {
  if (!delta) return position;
  const mine = budget.lines.filter((x) => x.department === department && x.head === head);
  if (!mine.length) {
    const s = await budgetSettings();
    const percents = methodPercents(s.allocationMethod, s.seasonalPercents);
    await tx.budgetLine.create({
      data: {
        id: newId(),
        budgetId: budget.id,
        position,
        head,
        category: headOf(head)?.category ?? fallbackCategory,
        department,
        costCenter: 'ALL_DIVISIONS',
        annualAmount: delta,
        allocationMethod: s.allocationMethod,
        monthPercents: percents,
        monthAmounts: monthAmounts(delta, percents),
      },
    });
    return position + 1;
  }
  const original = mine.reduce((t, x) => t + Number(x.annualAmount), 0);
  let left = delta;
  for (const [j, x] of mine.entries()) {
    const share =
      j === mine.length - 1 ? round2(left) : Math.round((delta * Number(x.annualAmount)) / (original || 1));
    left -= share;
    const annual = round2(Number(x.annualAmount) + share);
    await tx.budgetLine.update({
      where: { id: x.id },
      data: { annualAmount: annual, monthAmounts: monthAmounts(annual, x.monthPercents as number[]) },
    });
  }
  return position;
}
export const nextPosition = (lines: Line[]) => lines.reduce((m, l) => Math.max(m, l.position), -1) + 1;
