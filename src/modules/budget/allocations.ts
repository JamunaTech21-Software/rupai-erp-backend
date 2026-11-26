import { join } from 'node:path';

import ExcelJS from 'exceljs';
import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { exportFormat, sendExport } from '../../lib/export.js';
import { writeHistory } from '../../lib/history.js';
import { longText, num, oneOf, ref } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { uploadRoot } from '../files/service.js';
import { MONTH_SHORT, cellValue, labelLines, methodPercents, norm, round2 } from './budgets.js';
import { BUDGET_DEPARTMENTS, OTHER_COST_CENTERS, headOf, labelIn } from './heads.js';
import { ALLOCATION_METHODS, budgetSettings, codeOf, fyLabel } from './settings.js';
import { EDITABLE, STATUSES, registerWorkflowDoc, statusLabel, workflowView } from './workflow.js';

/**
 * RP1-252 B.6 Monthly Allocation (`/budget-monthly-allocation`, `images/11.jpeg`).
 * - `GET /budgets/:id/allocation?view=DEPARTMENT|HEAD&department=&category=&allocation=`: the page (cards, grid,
 *   OPEX / CAPEX totals, donut, trend, status) from the budget's current split, or from a saved allocation.
 * - `POST /budget-allocations/preview`: Recalculate (Equal / Seasonal, Settings rounding) and hand edits of a grid
 *   row (a department or head row is spread over its budget lines by their annual amounts); nothing is saved.
 * - `/budget-allocations` (CRUD kit): Save Draft with every budget line's 12 amounts; each line must add up to its
 *   annual amount. Submit for Approval = budget workflow `ALLOCATION`; the last approval writes the amounts (and
 *   their %) to the budget's lines.
 * - Import (Excel) fills the grid (preview, not saved); Export (Excel / CSV) of the grid.
 */
const VALIDATION = 'Please correct the highlighted fields.';
const VIEWS = [
  { value: 'DEPARTMENT', label: 'Department View' },
  { value: 'HEAD', label: 'Budget Head View' },
];
const CATEGORY_FILTER = [
  { value: 'ALL', label: 'All (OPEX & CAPEX)' },
  { value: 'OPEX', label: 'OPEX' },
  { value: 'CAPEX', label: 'CAPEX' },
];
const valuesOf = (l: { value: string }[]) => l.map((o) => o.value);
const numbered = <T extends object>(l: T[]) => l.map((o, i) => ({ id: i + 1, ...o }));
const sum = (l: number[]) => round2(l.reduce((s, v) => s + v, 0));
const pct = (a: number, b: number) => (b ? round2((a / b) * 100) : 0);
const zeros = () => Array<number>(12).fill(0);

/** 12 amounts of `amount` by `percents`; months 1 to 11 rounded to `unit`, December takes the rest. */
export function roundedSplit(amount: number, percents: number[], unit: number) {
  const u = unit > 0 ? unit : 1;
  const out = percents.slice(0, 11).map((p) => Math.round((amount * p) / 100 / u) * u);
  out.push(round2(amount - out.reduce((s, v) => s + v, 0)));
  return out;
}

interface BLine {
  id: string;
  head: string;
  department: string;
  category: string;
  costCenter: string;
  annualAmount: number;
  monthAmounts: number[];
  allocationMethod: string;
}
async function budgetWithLines(id: string) {
  const b = await db.budget.findFirst({
    where: { id, deletedAt: null },
    include: { lines: { orderBy: { position: 'asc' } }, estateRef: { select: { estateName: true } } },
  });
  if (!b) return null;
  const lines: BLine[] = b.lines.map((l) => ({
    id: l.id,
    head: l.head,
    department: l.department,
    category: l.category,
    costCenter: l.costCenter,
    annualAmount: Number(l.annualAmount),
    monthAmounts: (l.monthAmounts as number[]).map(Number),
    allocationMethod: l.allocationMethod,
  }));
  return { budget: b, lines };
}
type Labelled = BLine & {
  headLabel: string | null;
  departmentLabel: string | null;
  costCenterLabel: string | null;
};
const withLabels = async (lines: BLine[]) =>
  (await labelLines(lines.map((l) => ({ ...l })))) as unknown as Labelled[];
const inFilter = (l: BLine, department: string, category: string) =>
  (!department || l.department === department) && (category === 'ALL' || l.category === category);

function readFilters(q: Record<string, unknown>) {
  const s = (k: string) => (typeof q[k] === 'string' ? q[k].trim() : '');
  const fields: Record<string, string> = {};
  const view = (s('view') || 'DEPARTMENT').toUpperCase();
  if (!valuesOf(VIEWS).includes(view)) fields.view = 'Select a value from the list.';
  const category = (s('category') || 'ALL').toUpperCase();
  if (!valuesOf(CATEGORY_FILTER).includes(category)) fields.category = 'Select a value from the list.';
  const department = s('department') === 'ALL' ? '' : s('department');
  if (department && !valuesOf(BUDGET_DEPARTMENTS).includes(department))
    fields.department = 'Select a value from the list.';
  return { view, category, department, fields };
}

/** Grid rows, totals, cards, donut, trend and status for the lines in the filter. */
function grid(
  lines: BLine[],
  amounts: Map<string, number[]>,
  view: string,
  department: string,
  category: string,
) {
  const shown = lines.filter((l) => inFilter(l, department, category));
  const months = (l: BLine) => amounts.get(l.id) ?? l.monthAmounts;
  const groups = new Map<string, { key: string; lines: BLine[] }>();
  for (const l of shown) {
    const key = view === 'HEAD' ? l.head : `${l.department}|${l.category}`;
    const g = groups.get(key) ?? { key, lines: [] };
    g.lines.push(l);
    groups.set(key, g);
  }
  const rowOf = (g: { key: string; lines: BLine[] }) => {
    const first = g.lines[0] as BLine;
    const m = zeros().map((_, i) => round2(g.lines.reduce((s, l) => s + (months(l)[i] ?? 0), 0)));
    const annual = sum(g.lines.map((l) => l.annualAmount));
    const total = sum(m);
    return {
      key: g.key,
      department: view === 'HEAD' ? null : first.department,
      head: view === 'HEAD' ? first.head : null,
      label:
        view === 'HEAD'
          ? (headOf(first.head)?.label ?? first.head)
          : (labelIn(BUDGET_DEPARTMENTS, first.department) ?? first.department),
      category: first.category,
      categoryLabel: first.category,
      annualAmount: annual,
      monthAmounts: m,
      total,
      difference: round2(annual - total),
      balanced: Math.abs(annual - total) < 0.01,
      budgetLines: g.lines.map((l) => l.id),
    };
  };
  const rows = [...groups.values()].map(rowOf);
  const section = (cat: string) => {
    const list = rows.filter((r) => r.category === cat).map((r, i) => ({ sl: 0, ...r, _i: i }));
    const m = zeros().map((_, i) => round2(list.reduce((s, r) => s + (r.monthAmounts[i] ?? 0), 0)));
    return {
      rows: list.map(({ _i, ...r }) => r),
      total: {
        label: `Total – ${cat}`,
        annualAmount: sum(list.map((r) => r.annualAmount)),
        monthAmounts: m,
        total: sum(m),
      },
    };
  };
  const opex = section('OPEX');
  const capex = section('CAPEX');
  let sl = 1;
  for (const r of [...opex.rows, ...capex.rows]) r.sl = sl++;
  const grandMonths = zeros().map((_, i) =>
    round2((opex.total.monthAmounts[i] ?? 0) + (capex.total.monthAmounts[i] ?? 0)),
  );
  const annual = round2(opex.total.annualAmount + capex.total.annualAmount);
  const allocated = sum(grandMonths);
  const unbalanced = shown.filter((l) => Math.abs(sum(months(l)) - l.annualAmount) >= 0.01).length;
  const negative = shown.some((l) => months(l).some((v) => v < 0));
  const complete = !unbalanced && !negative && shown.length > 0;
  return {
    cards: {
      annualBudget: annual,
      allocated,
      opexAllocation: opex.total.total,
      capexAllocation: capex.total.total,
      allocationStatus: pct(allocated, annual),
    },
    opex,
    capex,
    grandTotal: {
      label: 'Grand Total (OPEX + CAPEX)',
      annualAmount: annual,
      monthAmounts: grandMonths,
      total: allocated,
    },
    overview: {
      total: allocated,
      opex: { amount: opex.total.total, percent: pct(opex.total.total, allocated) },
      capex: { amount: capex.total.total, percent: pct(capex.total.total, allocated) },
    },
    trend: zeros().map((_, i) => ({
      month: i + 1,
      label: MONTH_SHORT[i],
      opex: opex.total.monthAmounts[i] ?? 0,
      capex: capex.total.monthAmounts[i] ?? 0,
    })),
    status: {
      complete,
      unbalancedLines: unbalanced,
      message: complete
        ? `Monthly allocation is complete (${pct(allocated, annual).toFixed(2)}%).`
        : negative
          ? 'Some months are below 0.'
          : `${unbalanced} budget line(s) do not add up to their annual amount (${pct(allocated, annual).toFixed(2)}% allocated).`,
      totalAllocated: allocated,
    },
  };
}

/** The page answer for a budget and a set of amounts. */
async function page(
  b: NonNullable<Awaited<ReturnType<typeof budgetWithLines>>>,
  amounts: Map<string, number[]>,
  q: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  const { view, category, department, fields } = readFilters(q);
  if (Object.keys(fields).length) throw new AppError('VALIDATION', VALIDATION, fields);
  const settings = await budgetSettings();
  const labelled = await withLabels(b.lines);
  return {
    budget: {
      id: b.budget.id,
      budgetCode: b.budget.budgetCode,
      budgetName: b.budget.budgetName,
      status: b.budget.status,
      statusLabel: statusLabel(b.budget.status),
    },
    estate: b.budget.estate,
    estateName: b.budget.estateRef.estateName,
    financialYear: b.budget.financialYear,
    financialYearLabel: fyLabel(b.budget.financialYear),
    view,
    department: department || null,
    category,
    allocationMethod: (extra.allocationMethod as string | undefined) ?? settings.allocationMethod,
    ...extra,
    ...grid(b.lines, amounts, view, department, category),
    lines: labelled.map((l) => {
      const m = amounts.get(String(l.id)) ?? l.monthAmounts;
      const annual = Number(l.annualAmount);
      return {
        budgetLine: l.id,
        head: l.head,
        headLabel: l.headLabel,
        department: l.department,
        departmentLabel: l.departmentLabel,
        category: l.category,
        costCenter: l.costCenter,
        costCenterLabel: l.costCenterLabel,
        annualAmount: annual,
        monthAmounts: m,
        total: sum(m),
        balanced: Math.abs(sum(m) - annual) < 0.01,
      };
    }),
  };
}

const monthsSchema = z
  .array(
    num('Must be 0 or more.')
      .refine((v) => v >= 0, 'Must be 0 or more.')
      .refine((v) => v < 1e13, 'Too large.'),
    { error: 'Send the 12 monthly amounts.' },
  )
  .length(12, 'Send the 12 monthly amounts.');
const lineSchema = z.object({ budgetLine: ref(), monthAmounts: monthsSchema });
const schema = z.object({
  budget: ref(),
  allocationMethod: oneOf(valuesOf(ALLOCATION_METHODS)),
  notes: longText(),
});

/** Problems of a full set of line amounts against the budget (keys `lines`, `lines.<i>.*`). */
function lineProblems(lines: BLine[], given: { budgetLine: unknown; monthAmounts: unknown }[]) {
  const fields: Record<string, string> = {};
  const byId = new Map(lines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  given.forEach((g, i) => {
    const l = byId.get(String(g.budgetLine));
    if (!l) return void (fields[`lines.${i}.budgetLine`] = 'Not a line of this budget.');
    if (seen.has(l.id)) return void (fields[`lines.${i}.budgetLine`] = 'This budget line is given twice.');
    seen.add(l.id);
    const total = sum((g.monthAmounts as number[]) ?? []);
    if (Math.abs(total - l.annualAmount) >= 0.01)
      fields[`lines.${i}.monthAmounts`] =
        `The 12 months must add up to the annual amount ${l.annualAmount.toLocaleString('en-IN')} (now ${total.toLocaleString('en-IN')}).`;
  });
  const missing = lines.filter((l) => !seen.has(l.id)).length;
  if (missing && !Object.keys(fields).length)
    fields.lines = `Every budget line needs its 12 months (${missing} missing).`;
  return fields;
}

async function nextCode(financialYear: string) {
  const s = await budgetSettings();
  const n = s.numbering.find((x) => x.docType === 'ALLOCATION') ?? {
    docType: 'ALLOCATION',
    prefix: 'ALLOC',
    digits: 4,
  };
  const year = Number(financialYear.slice(0, 4));
  const start = `${n.prefix}-${year}-`;
  const rows = await db.budgetAllocation.findMany({
    where: { code: { startsWith: start } },
    select: { code: true },
  });
  return codeOf(
    n,
    year,
    rows.reduce((top, r) => Math.max(top, Number(r.code.slice(start.length)) || 0), 0) + 1,
  );
}

export const budgetAllocationsRouter = defineResource('/budget-allocations', {
  name: 'budgetAllocation',
  label: 'Monthly allocation',
  module: 'budget',
  page: 'Monthly Allocation',
  describe: (r) => show(r.code, paren(r.allocationMethod)),
  model: 'budgetAllocation',
  schema,
  search: ['code', 'notes'],
  filters: ['estate', 'financialYear', 'budget', 'status'],
  refs: { estate: { model: 'estate', label: 'estateName' } },
  children: [
    {
      key: 'lines',
      model: 'budgetAllocationLine',
      parentKey: 'allocationId',
      schema: lineSchema,
      decorate: async (rows, parent) => {
        const b = await budgetWithLines(String(parent.budget));
        const labelled = new Map((await withLabels(b?.lines ?? [])).map((l) => [String(l.id), l]));
        return rows.map((r) => {
          const l = labelled.get(String(r.budgetLine));
          const m = (r.monthAmounts as number[]).map(Number);
          const annual = l ? Number(l.annualAmount) : 0;
          return {
            ...r,
            head: l?.head ?? null,
            headLabel: l?.headLabel ?? null,
            department: l?.department ?? null,
            departmentLabel: l?.departmentLabel ?? null,
            category: l?.category ?? null,
            costCenterLabel: l?.costCenterLabel ?? null,
            annualAmount: annual,
            total: sum(m),
            monthPercents: m.map((v) => pct(v, annual)),
            balanced: Math.abs(sum(m) - annual) < 0.01,
          };
        });
      },
    },
  ],
  orderBy: [{ financialYear: 'desc' }, { code: 'desc' }, { id: 'asc' }],
  skipApproval: () => true,
  check: async (values, id, rows) => {
    const fields: Record<string, string> = {};
    if (id) {
      const before = await db.budgetAllocation.findFirst({
        where: { id, deletedAt: null },
        select: { status: true, budget: true },
      });
      if (before && !EDITABLE.includes(before.status))
        fields.status = `This allocation is ${statusLabel(before.status)}: only a Draft or Returned one can be edited.`;
      if (before && before.budget !== values.budget)
        fields.budget = 'The budget of an allocation cannot be changed.';
    }
    const b = await budgetWithLines(String(values.budget));
    if (!b) fields.budget = 'Select an annual budget.';
    else if (b.budget.status !== 'APPROVED')
      fields.budget = `${b.budget.budgetCode} is ${statusLabel(b.budget.status)}: pick an Approved annual budget.`;
    if (values.allocationMethod === 'MANUAL' && !(await budgetSettings()).allowManualAllocation)
      fields.allocationMethod = 'Manual allocation is turned off in Budget Settings.';
    if (b && !fields.budget)
      Object.assign(
        fields,
        lineProblems(b.lines, (rows?.lines ?? []) as { budgetLine: unknown; monthAmounts: unknown }[]),
      );
    return fields;
  },
  onSave: async (values) => {
    const b = await db.budget.findUnique({
      where: { id: String(values.budget) },
      select: { estate: true, financialYear: true },
    });
    return b ? { estate: b.estate, financialYear: b.financialYear } : {};
  },
  onCreate: async (values) => ({ code: await nextCode(String(values.financialYear)), status: 'DRAFT' }),
  extend: (row) => ({
    financialYearLabel: fyLabel(String(row.financialYear)),
    allocationMethodLabel: labelIn(ALLOCATION_METHODS, row.allocationMethod),
    statusLabel: statusLabel(row.status),
    preparedBy: row.createdBy,
    editable: EDITABLE.includes(String(row.status)),
  }),
  enrich: async (rows) => {
    const budgets = new Map(
      (
        await db.budget.findMany({
          where: { id: { in: [...new Set(rows.map((r) => String(r.budget)))] } },
          select: { id: true, budgetCode: true, budgetName: true, lines: { select: { annualAmount: true } } },
        })
      ).map((b) => [b.id, b]),
    );
    const lines = await db.budgetAllocationLine.findMany({
      where: { allocationId: { in: rows.map((r) => String(r.id)) } },
      select: { allocationId: true, monthAmounts: true },
    });
    return new Map(
      rows.map((r) => {
        const b = budgets.get(String(r.budget));
        const annual = sum(b?.lines.map((l) => Number(l.annualAmount)) ?? []);
        const allocated = sum(
          lines
            .filter((l) => l.allocationId === r.id)
            .flatMap((l) => (l.monthAmounts as number[]).map(Number)),
        );
        return [
          String(r.id),
          {
            budgetCode: b?.budgetCode ?? null,
            budgetName: b?.budgetName ?? null,
            annualBudget: annual,
            allocated,
            allocationStatus: pct(allocated, annual),
          },
        ];
      }),
    );
  },
  deleteCheck: (row) =>
    Promise.resolve(
      EDITABLE.includes(String(row.status)) || row.status === 'REJECTED'
        ? undefined
        : `This allocation is ${statusLabel(row.status)}: only a Draft, Returned or Rejected one can be deleted.`,
    ),
  export: {
    fileName: 'monthly-allocations',
    sheet: 'Monthly Allocations',
    columns: [
      { header: 'SL', value: (_r, i) => i + 1, width: 6 },
      { header: 'Code', value: (r) => r.code, width: 18 },
      { header: 'Budget', value: (r) => r.budgetCode, width: 16 },
      { header: 'Financial Year', value: (r) => r.financialYearLabel, width: 14 },
      { header: 'Estate', value: (r) => r.estateName, width: 24 },
      { header: 'Method', value: (r) => r.allocationMethodLabel, width: 20 },
      { header: 'Allocated (৳)', value: (r) => r.allocated, width: 18, numFmt: '#,##0' },
      { header: 'Status', value: (r) => r.statusLabel, width: 12 },
    ],
  },
  options: {
    path: 'budget-allocations',
    label: (row) => `${String(row.code)} — ${String(row.allocationMethod)}`,
    filters: ['budget', 'status'],
  },
});

async function savedLines(allocationId: string) {
  return (
    await db.budgetAllocationLine.findMany({
      where: { allocationId },
      select: { budgetLine: true, monthAmounts: true },
    })
  ).map((l) => ({ budgetLine: l.budgetLine, monthAmounts: (l.monthAmounts as number[]).map(Number) }));
}

registerWorkflowDoc({
  docType: 'ALLOCATION',
  label: 'Monthly allocation',
  resource: 'budgetAllocation',
  find: (id) => db.budgetAllocation.findFirst({ where: { id } }),
  update: async (tx, id, from, data) =>
    (
      await tx.budgetAllocation.updateMany({
        where: { id, deletedAt: null, status: from.status, currentStep: from.currentStep },
        data: {
          ...data,
          workflowLevels: data.workflowLevels === undefined ? undefined : (data.workflowLevels as object),
          updatedAt: new Date(),
        },
      })
    ).count,
  code: (row) => String(row.code),
  canSubmit: async (row) => {
    const b = await budgetWithLines(String(row.budget));
    if (!b || b.budget.status !== 'APPROVED') return 'The annual budget is no longer Approved.';
    const other = await db.budgetAllocation.findFirst({
      where: { budget: b.budget.id, status: 'PENDING', deletedAt: null, NOT: { id: String(row.id) } },
      select: { code: true },
    });
    if (other) return `${other.code} of this budget is already waiting for approval.`;
    const problems = lineProblems(b.lines, await savedLines(String(row.id)));
    if (Object.keys(problems).length)
      return 'The budget lines changed since this allocation was saved: open it, check the amounts and save again.';
    return undefined;
  },
  onApproved: async (tx, row, userId) => {
    const b = await budgetWithLines(String(row.budget));
    const given = await savedLines(String(row.id));
    if (!b || Object.keys(lineProblems(b.lines, given)).length)
      throw new AppError(
        'DUPLICATE',
        'The budget lines changed since this allocation was saved; return it to the preparer.',
      );
    const byId = new Map(b.lines.map((l) => [l.id, l]));
    for (const g of given) {
      const l = byId.get(g.budgetLine) as BLine;
      const p = g.monthAmounts.slice(0, 11).map((v) => pct(v, l.annualAmount));
      p.push(round2(100 - sum(p)));
      await tx.budgetLine.update({
        where: { id: l.id },
        data: {
          monthAmounts: g.monthAmounts,
          monthPercents: p,
          allocationMethod: String(row.allocationMethod),
        },
      });
    }
    await tx.budget.update({
      where: { id: b.budget.id },
      data: { updatedAt: new Date(), updatedBy: userId },
    });
    await writeHistory(tx, {
      resource: 'budget',
      recordId: b.budget.id,
      action: 'update',
      newData: { monthlyAllocation: String(row.code), lines: given.length },
      userId,
      approvalId: null,
    });
  },
});

// ---- Page, preview, import --------------------------------------------------------------------------------------

/** `/budgets/:id/allocation` (+ `/export`); mounted on `/budgets`. */
export const budgetAllocationViewRouter = Router();

async function amountsFor(budgetId: string, allocation: string) {
  const amounts = new Map<string, number[]>();
  let extra: Record<string, unknown> = {};
  if (allocation) {
    const a = await db.budgetAllocation.findFirst({
      where: { id: allocation, budget: budgetId, deletedAt: null },
    });
    if (!a) throw notFound('Monthly allocation');
    for (const l of await savedLines(a.id)) amounts.set(l.budgetLine, l.monthAmounts);
    extra = {
      allocation: {
        id: a.id,
        code: a.code,
        status: a.status,
        statusLabel: statusLabel(a.status),
        editable: EDITABLE.includes(a.status),
      },
      allocationMethod: a.allocationMethod,
      notes: a.notes,
    };
  }
  return { amounts, extra };
}

budgetAllocationViewRouter.get('/:id/allocation', async (req, res) => {
  const b = await budgetWithLines(req.params.id);
  if (!b) throw notFound('Budget');
  const { amounts, extra } = await amountsFor(
    b.budget.id,
    typeof req.query.allocation === 'string' ? req.query.allocation : '',
  );
  res.json(await page(b, amounts, req.query, extra));
});

budgetAllocationViewRouter.get('/:id/allocation/export', async (req, res) => {
  const format = exportFormat(req.query.format);
  const b = await budgetWithLines(req.params.id);
  if (!b) throw notFound('Budget');
  const { amounts, extra } = await amountsFor(
    b.budget.id,
    typeof req.query.allocation === 'string' ? req.query.allocation : '',
  );
  const p = await page(b, amounts, req.query, extra);
  const rows = [
    ...p.opex.rows,
    { ...p.opex.total, sl: '' },
    ...p.capex.rows,
    { ...p.capex.total, sl: '' },
    { ...p.grandTotal, sl: '' },
  ] as Record<string, unknown>[];
  await sendExport(res, format, {
    fileName: `monthly-allocation-${b.budget.budgetCode}`,
    sheet: 'Monthly Allocation',
    rows,
    columns: [
      { header: '#', value: (r) => r.sl, width: 5 },
      { header: p.view === 'HEAD' ? 'Budget Head' : 'Department', value: (r) => r.label, width: 32 },
      { header: 'Category', value: (r) => r.category ?? '', width: 10 },
      { header: 'Annual Amount (৳)', value: (r) => r.annualAmount, width: 18, numFmt: '#,##0' },
      ...MONTH_SHORT.map((m, i) => ({
        header: m,
        value: (r: Record<string, unknown>) => (r.monthAmounts as number[])[i],
        width: 13,
        numFmt: '#,##0',
      })),
      { header: 'Total (৳)', value: (r) => r.total, width: 18, numFmt: '#,##0' },
    ],
  });
});

export const budgetAllocationExtrasRouter = Router();

budgetAllocationExtrasRouter.get('/filter-options', async (_req, res) => {
  const s = await budgetSettings();
  res.json({
    views: numbered(VIEWS),
    categories: numbered(CATEGORY_FILTER),
    departments: numbered(BUDGET_DEPARTMENTS),
    allocationMethods: numbered(ALLOCATION_METHODS),
    defaultAllocationMethod: s.allocationMethod,
    allowManualAllocation: s.allowManualAllocation,
    seasonalPercents: s.seasonalPercents,
    rounding: s.allocationRounding,
    statuses: numbered(STATUSES),
    notes: [
      'Monthly allocation is based on seasonal plan for tea cultivation and estate operations.',
      'Allocation can be manually adjusted for any department or budget head.',
      'Total monthly allocation must equal the approved annual budget.',
    ],
  });
});

budgetAllocationExtrasRouter.get('/next-code', async (req, res) => {
  const b =
    typeof req.query.budget === 'string'
      ? await db.budget.findFirst({
          where: { id: req.query.budget, deletedAt: null },
          select: { financialYear: true },
        })
      : null;
  res.json({ code: await nextCode(b?.financialYear ?? (await budgetSettings()).defaultFinancialYear) });
});

const previewSchema = z.object({
  budget: ref(),
  view: z.string().optional(),
  department: z.string().optional(),
  category: z.string().optional(),
  method: z.enum(['EQUAL', 'SEASONAL', 'MANUAL'], { error: 'Select a value from the list.' }).optional(),
  lines: z
    .array(
      lineSchema.extend({
        monthAmounts: z.array(num('Must be a number.')).length(12, 'Send the 12 monthly amounts.'),
      }),
    )
    .optional(),
  rows: z
    .array(
      z.object({
        key: z.string().trim().min(1),
        monthAmounts: z.array(num('Must be a number.')).length(12, 'Send the 12 monthly amounts.'),
      }),
    )
    .optional(),
});

/**
 * Body `{ budget, view, department, category, lines?, rows?, method? }`: start from `lines` (the page's amounts;
 * lines not sent keep the budget's split), apply edited grid `rows` (key of the row in the view), then `method`
 * Equal / Seasonal recalculates the lines in the filter. Answers the page; nothing is saved.
 */
budgetAllocationExtrasRouter.post('/preview', async (req, res) => {
  const parsed = previewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[i.path.join('.')] ??= i.message;
    throw new AppError('VALIDATION', VALIDATION, fields);
  }
  const body = parsed.data;
  const b = await budgetWithLines(body.budget);
  if (!b) throw notFound('Budget');
  const { view, category, department, fields } = readFilters(body);
  if (Object.keys(fields).length) throw new AppError('VALIDATION', VALIDATION, fields);
  const settings = await budgetSettings();
  const amounts = new Map<string, number[]>(b.lines.map((l) => [l.id, [...l.monthAmounts]]));
  const byId = new Map(b.lines.map((l) => [l.id, l]));
  (body.lines ?? []).forEach((g, i) => {
    if (!byId.has(g.budgetLine)) fields[`lines.${i}.budgetLine`] = 'Not a line of this budget.';
    else amounts.set(g.budgetLine, g.monthAmounts.map(round2));
  });
  const shown = b.lines.filter((l) => inFilter(l, department, category));
  (body.rows ?? []).forEach((r, i) => {
    const group = shown.filter((l) => (view === 'HEAD' ? l.head : `${l.department}|${l.category}`) === r.key);
    if (!group.length) return void (fields[`rows.${i}.key`] = 'No such row in this view.');
    if (r.monthAmounts.some((v) => v < 0))
      return void (fields[`rows.${i}.monthAmounts`] = 'Must be 0 or more.');
    const annual = sum(group.map((l) => l.annualAmount));
    const split = group.map(() => zeros());
    for (let m = 0; m < 12; m++) {
      let left = r.monthAmounts[m] ?? 0;
      group.forEach((l, j) => {
        if (j === group.length - 1) return;
        const v =
          m < 11
            ? Math.round(((r.monthAmounts[m] ?? 0) * l.annualAmount) / (annual || 1))
            : round2(l.annualAmount - sum((split[j] as number[]).slice(0, 11)));
        (split[j] as number[])[m] = v;
        left -= v;
      });
      (split[group.length - 1] as number[])[m] = round2(left);
    }
    group.forEach((l, j) => amounts.set(l.id, split[j] as number[]));
  });
  if (Object.keys(fields).length) throw new AppError('VALIDATION', VALIDATION, fields);
  let method = 'MANUAL';
  if (body.method && body.method !== 'MANUAL') {
    method = body.method;
    const percents = methodPercents(method, settings.seasonalPercents);
    for (const l of shown)
      amounts.set(l.id, roundedSplit(l.annualAmount, percents, settings.allocationRounding));
  } else if (!body.lines?.length && !body.rows?.length && body.method === undefined)
    method = settings.allocationMethod;
  res.json(await page(b, amounts, body, { allocationMethod: method }));
});

budgetAllocationExtrasRouter.get('/:id/workflow', async (req, res) => {
  const row = await db.budgetAllocation.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!row) throw notFound('Monthly allocation');
  res.json(await workflowView('ALLOCATION', row));
});

const TEMPLATE = [
  'Line ID',
  'Department',
  'Budget Head',
  'Division / Cost Center',
  'Annual Amount (৳)',
  ...MONTH_SHORT,
];

/** Template filled with the budget's lines and their current split; change the months and import it. */
budgetAllocationExtrasRouter.get('/import-template', async (req, res) => {
  const b = typeof req.query.budget === 'string' ? await budgetWithLines(req.query.budget) : null;
  if (!b) throw new AppError('VALIDATION', VALIDATION, { budget: 'Select an annual budget.' });
  const labelled = await withLabels(b.lines);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Monthly Allocation');
  sheet.addRow(TEMPLATE);
  sheet.getRow(1).font = { bold: true };
  for (const l of labelled)
    sheet.addRow([
      l.id,
      l.departmentLabel,
      l.headLabel,
      l.costCenterLabel,
      Number(l.annualAmount),
      ...l.monthAmounts,
    ]);
  sheet.columns.forEach((c, i) => (c.width = i === 0 ? 28 : i < 5 ? 24 : 12));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="monthly-allocation-${b.budget.budgetCode}.xlsx"`,
  );
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(Buffer.from(await book.xlsx.writeBuffer()));
});

/**
 * `POST /budget-allocations/import { budget, file, view?, department?, category? }`: rows matched by Line ID (else
 * department + head + cost center), months read as taka. A wrong row refuses the whole file
 * (`rows.<excel row>.<field>`). Answers the page with the file's amounts (Manual); Save Draft keeps them.
 */
budgetAllocationExtrasRouter.post('/import', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const b = typeof body.budget === 'string' ? await budgetWithLines(body.budget) : null;
  if (!b) throw new AppError('VALIDATION', VALIDATION, { budget: 'Select an annual budget.' });
  const file =
    typeof body.file === 'string' ? await db.storedFile.findUnique({ where: { id: body.file } }) : null;
  if (!file || !/\.xlsx$/i.test(file.storageKey))
    throw new AppError('VALIDATION', VALIDATION, { file: 'Upload the filled template (.xlsx).' });
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.readFile(join(uploadRoot(), file.storageKey));
  } catch {
    throw new AppError('VALIDATION', VALIDATION, { file: 'The file could not be read as Excel.' });
  }
  const sheet = book.worksheets[0];
  if (!sheet) throw new AppError('VALIDATION', VALIDATION, { file: 'The file has no sheet.' });
  const labelled = await withLabels(b.lines);
  const fields: Record<string, string> = {};
  const amounts = new Map<string, number[]>();
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const v = (i: number) => cellValue(row.getCell(i).value);
    if ([1, 2, 3].every((i) => norm(v(i)) === '')) return;
    const at = (k: string, m: string) => (fields[`rows.${n}.${k}`] ??= m);
    const ccText = norm(v(4)) || norm(OTHER_COST_CENTERS[0]?.label);
    const line =
      labelled.find((l) => norm(l.id) === norm(v(1))) ??
      labelled.find(
        (l) =>
          [norm(l.departmentLabel), norm(l.department)].includes(norm(v(2))) &&
          [norm(l.headLabel), norm(l.head)].includes(norm(v(3))) &&
          norm(l.costCenterLabel) === ccText,
      );
    if (!line)
      return void at('line', 'No such line in this budget (check department, budget head and cost center).');
    if (amounts.has(String(line.id))) return void at('line', 'This budget line is in the file twice.');
    const m = MONTH_SHORT.map((_, i) => Number(v(6 + i) ?? 0));
    if (m.some((x) => !Number.isFinite(x) || x < 0))
      return void at('monthAmounts', 'Months must be numbers of 0 or more.');
    const annual = Number(line.annualAmount);
    if (Math.abs(sum(m) - annual) >= 0.01)
      at(
        'monthAmounts',
        `The 12 months must add up to ${annual.toLocaleString('en-IN')} (now ${sum(m).toLocaleString('en-IN')}).`,
      );
    amounts.set(String(line.id), m.map(round2));
  });
  if (Object.keys(fields).length)
    throw new AppError('VALIDATION', 'Some rows of the file are wrong; nothing was changed.', fields);
  if (!amounts.size)
    throw new AppError('VALIDATION', VALIDATION, { file: 'The file has no allocation rows.' });
  res.json(await page(b, amounts, body, { allocationMethod: 'MANUAL', importedLines: amounts.size }));
});

const doc = (summary: string, method: 'get' | 'post' = 'get') => ({
  [method]: { tags: ['Budget'], summary, responses: { '200': { description: 'ok' } } },
});
docsPaths['/budgets/{id}/allocation'] = doc(
  'Monthly Allocation page: ?view=DEPARTMENT|HEAD&department=&category=ALL|OPEX|CAPEX&allocation=',
);
docsPaths['/budgets/{id}/allocation/export'] = doc('Monthly Allocation grid as xlsx (default) or csv');
docsPaths['/budget-allocations/filter-options'] = doc('Monthly Allocation lists');
docsPaths['/budget-allocations/next-code'] = doc('Next ALLOC code for ?budget=');
docsPaths['/budget-allocations/preview'] = doc(
  'Recalculate / spread row edits: { budget, view, department, category, lines?, rows?, method? }',
  'post',
);
docsPaths['/budget-allocations/import-template'] = doc('Excel of the budget lines and their split: ?budget=');
docsPaths['/budget-allocations/import'] = doc('Read an Excel into the page: { budget, file }', 'post');
docsPaths['/budget-allocations/{id}/workflow'] = doc('Approval Workflow card of an allocation');
