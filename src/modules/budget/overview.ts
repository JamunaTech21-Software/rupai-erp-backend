import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { exportFormat, sendExport } from '../../lib/export.js';
import { round2 } from './budgets.js';
import { BUDGET_DEPARTMENTS, CATEGORY_LABELS, headOf, labelIn } from './heads.js';
import { budgetSettings, fyLabel } from './settings.js';
import { spending, spentOf } from './spending.js';
import { statusLabel, workflowView } from './workflow.js';

/**
 * RP1-249 B.5 Department Budget (`/budget-department`, `images/13.jpeg`): `GET /budget/department-overview?estate=
 * &financialYear=&department=&category=`. Built from the estate's annual budget for the year (the Approved one, or
 * the latest one when none is approved yet: `annualBudget.status` says which). Department-wise table, share, the
 * picked department's heads and monthly OPEX / CAPEX, its summary with actual / commitment (0 until Expense Entry,
 * B.7) and the annual budget's workflow card. Each department row lists its department budgets (B.4 / B.5) so the
 * page can view / edit / delete them.
 */
export const budgetOverviewRouter = Router();
const VALIDATION = 'Please correct the highlighted fields.';
const CATS = ['ALL', 'OPEX', 'CAPEX'];
const pct = (a: number, b: number) => (b ? round2((a / b) * 100) : 0);

async function build(query: Record<string, unknown>) {
  const q = (k: string) => (typeof query[k] === 'string' ? query[k].trim() : '');
  const settings = await budgetSettings();
  const fields: Record<string, string> = {};
  const estate = q('estate')
    ? await db.estate.findFirst({
        where: { id: q('estate'), deletedAt: null },
        select: { id: true, estateName: true },
      })
    : null;
  if (!estate) fields.estate = 'Select an estate.';
  const fy = q('financialYear') || settings.defaultFinancialYear;
  if (!/^\d{4}-\d{4}$/.test(fy)) fields.financialYear = 'Select a financial year from the list.';
  const category = (q('category') || 'ALL').toUpperCase();
  if (!CATS.includes(category)) fields.category = 'Select a value from the list.';
  const department = q('department');
  if (department && !BUDGET_DEPARTMENTS.some((d) => d.value === department))
    fields.department = 'Select a value from the list.';
  if (Object.keys(fields).length || !estate) throw new AppError('VALIDATION', VALIDATION, fields);

  const budgets = await db.budget.findMany({
    where: { estate: estate.id, financialYear: fy, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    include: { lines: true },
  });
  const annual = budgets.find((b) => b.status === 'APPROVED') ?? budgets[0] ?? null;
  const lines = (annual?.lines ?? []).filter((l) => category === 'ALL' || l.category === category);
  const spent = await spending(estate.id, fy);
  const include = settings.includeCommitment;
  const deptBudgets = annual
    ? await db.departmentBudget.findMany({
        where: { budget: annual.id, deletedAt: null },
        orderBy: { code: 'asc' },
        include: { lines: { select: { annualAmount: true } } },
      })
    : [];

  const total = round2(lines.reduce((s, l) => s + Number(l.annualAmount), 0));
  const sumOf = (list: typeof lines, cat?: string) =>
    round2(list.filter((l) => !cat || l.category === cat).reduce((s, l) => s + Number(l.annualAmount), 0));
  const spentSum = (list: typeof lines) =>
    list.reduce(
      (s, l) => {
        const x = spentOf(spent, {
          estate: estate.id,
          financialYear: fy,
          department: l.department,
          head: l.head,
        });
        return { actual: s.actual + x.actual, commitment: s.commitment + x.commitment };
      },
      { actual: 0, commitment: 0 },
    );

  const departments = BUDGET_DEPARTMENTS.map((d) => {
    const mine = lines.filter((l) => l.department === d.value);
    const t = sumOf(mine);
    const sp = spentSum(mine);
    return {
      department: d.value,
      departmentLabel: d.label,
      opex: sumOf(mine, 'OPEX'),
      capex: sumOf(mine, 'CAPEX'),
      total: t,
      percentOfTotal: pct(t, total),
      actual: round2(sp.actual),
      commitment: round2(sp.commitment),
      utilization: pct(sp.actual + (include ? sp.commitment : 0), t),
      departmentBudgets: deptBudgets
        .filter((b) => b.department === d.value)
        .map((b) => ({
          id: b.id,
          code: b.code,
          budgetName: b.budgetName,
          category: b.category,
          annualAmount: round2(b.lines.reduce((s, l) => s + Number(l.annualAmount), 0)),
          status: b.status,
          statusLabel: statusLabel(b.status),
        })),
    };
  }).filter((d) => d.total > 0 || d.departmentBudgets.length);

  const picked = department || departments[0]?.department || '';
  const mine = lines.filter((l) => l.department === picked);
  const deptTotal = sumOf(mine);
  const byHead = new Map<string, { head: string; category: string; amount: number; months: number[] }>();
  for (const l of mine) {
    const row = byHead.get(l.head) ?? {
      head: l.head,
      category: l.category,
      amount: 0,
      months: Array<number>(12).fill(0),
    };
    row.amount += Number(l.annualAmount);
    (l.monthAmounts as number[]).forEach((v, i) => (row.months[i] = (row.months[i] ?? 0) + Number(v)));
    byHead.set(l.head, row);
  }
  const heads = [...byHead.values()].map((h) => ({
    head: h.head,
    headLabel: headOf(h.head)?.label ?? h.head,
    category: h.category,
    categoryLabel: CATEGORY_LABELS[h.category] ?? h.category,
    annualAmount: round2(h.amount),
    monthAmounts: h.months.map(round2),
    percentOfDepartment: pct(h.amount, deptTotal),
  }));
  const month = (cat: string) =>
    Array.from({ length: 12 }, (_, i) =>
      round2(
        mine
          .filter((l) => l.category === cat)
          .reduce((s, l) => s + Number((l.monthAmounts as number[])[i] ?? 0), 0),
      ),
    );
  const sp = spentSum(mine);
  const used = sp.actual + (include ? sp.commitment : 0);

  return {
    estateName: estate.estateName,
    fy,
    total,
    departments,
    body: {
      estate: estate.id,
      estateName: estate.estateName,
      financialYear: fy,
      financialYearLabel: fyLabel(fy),
      category,
      annualBudget: annual
        ? {
            id: annual.id,
            budgetCode: annual.budgetCode,
            budgetName: annual.budgetName,
            status: annual.status,
            statusLabel: statusLabel(annual.status),
          }
        : null,
      cards: {
        totalDepartmentBudget: total,
        opexBudget: sumOf(lines, 'OPEX'),
        capexBudget: sumOf(lines, 'CAPEX'),
        totalDepartments: departments.filter((d) => d.total > 0).length,
        totalBudgetHeads: new Set(lines.map((l) => l.head)).size,
      },
      departments,
      totals: {
        opex: sumOf(lines, 'OPEX'),
        capex: sumOf(lines, 'CAPEX'),
        total,
        percentOfTotal: total ? 100 : 0,
        utilization: pct(
          departments.reduce((s, d) => s + d.actual + (include ? d.commitment : 0), 0),
          total,
        ),
      },
      share: departments.map((d) => ({
        department: d.department,
        label: d.departmentLabel,
        amount: d.total,
        percent: d.percentOfTotal,
      })),
      selectedDepartment: picked || null,
      selectedDepartmentLabel: labelIn(BUDGET_DEPARTMENTS, picked),
      departmentHeads: heads,
      departmentHeadsTotal: deptTotal,
      monthlyAllocation: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        opex: month('OPEX')[i] ?? 0,
        capex: month('CAPEX')[i] ?? 0,
      })),
      departmentSummary: {
        department: picked || null,
        departmentLabel: labelIn(BUDGET_DEPARTMENTS, picked),
        opex: sumOf(mine, 'OPEX'),
        capex: sumOf(mine, 'CAPEX'),
        total: deptTotal,
        actual: round2(sp.actual),
        commitment: round2(sp.commitment),
        remaining: round2(deptTotal - used),
        utilization: pct(used, deptTotal),
      },
      workflow: annual ? await workflowView('ANNUAL_BUDGET', annual) : null,
      spendingSource: 'Expense Entry (RP1-255) — 0 until it is built',
    },
  };
}

budgetOverviewRouter.get('/department-overview', async (req, res) => {
  res.json((await build(req.query)).body);
});

budgetOverviewRouter.get('/department-overview/export', async (req, res) => {
  const format = exportFormat(req.query.format);
  const { departments, body } = await build(req.query);
  await sendExport(res, format, {
    fileName: `department-budget-${body.financialYear}`,
    sheet: 'Department-wise Budget',
    rows: [
      ...departments,
      {
        departmentLabel: 'Total',
        opex: body.totals.opex,
        capex: body.totals.capex,
        total: body.totals.total,
        percentOfTotal: body.totals.percentOfTotal,
        utilization: body.totals.utilization,
      },
    ],
    columns: [
      { header: 'Department', value: (r) => r.departmentLabel, width: 30 },
      { header: 'OPEX (৳)', value: (r) => r.opex, width: 16, numFmt: '#,##0' },
      { header: 'CAPEX (৳)', value: (r) => r.capex, width: 16, numFmt: '#,##0' },
      { header: 'Total Budget (৳)', value: (r) => r.total, width: 18, numFmt: '#,##0' },
      { header: '% of Total', value: (r) => r.percentOfTotal, width: 12, numFmt: '0.0' },
      { header: 'Utilization (Actual) %', value: (r) => r.utilization, width: 20, numFmt: '0.0' },
    ],
  });
});

docsPaths['/budget/department-overview'] = {
  get: {
    tags: ['Budget'],
    summary: 'Department Budget page for ?estate=&financialYear=&department=&category=ALL|OPEX|CAPEX',
    responses: { '200': { description: 'overview' }, '400': { description: 'fields' } },
  },
};
docsPaths['/budget/department-overview/export'] = {
  get: {
    tags: ['Budget'],
    summary: 'Department-wise Budget table as xlsx (default) or csv',
    responses: { '200': { description: 'file' } },
  },
};
