import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { defineCustomWrite, paren, runCustomWrite, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { list, longText, num, oneOf, optText, reqDate, text } from '../../lib/fields.js';
import { writeHistory } from '../../lib/history.js';
import { currentUserId, defineResource } from '../../lib/resource.js';
import { toJson } from '../../lib/serialize.js';
import { z } from '../../lib/validation.js';
import { todayDhaka } from '../weather/entries.js';
import { attachmentProblems, round2 } from './budgets.js';
import {
  BUDGET_DEPARTMENTS,
  BUDGET_HEADS,
  CATEGORY_LABELS,
  OTHER_COST_CENTERS,
  headOf,
  labelIn,
  subHeadOf,
} from './heads.js';
import { budgetSettings, codeOf, financialYearOf, financialYearRange, fyLabel } from './settings.js';
import { spending, spentOf } from './spending.js';
import { statusLabel } from './workflow.js';

/**
 * RP1-255 B.7 Expense Entry (`/budget-expenses`, no design; same style as the other pages). The source of Actual
 * and Commitment for every budget page and report until Accounts and Purchase exist.
 *
 * Budget Control (Budget Settings):
 * - Approved budget only: the estate's budget for the financial year must be Approved (off: the latest one).
 * - Require budget check: the department must have a budget for the head; with no budget at all, refused.
 * - Enforce budget limit: the head's used amount (actual, plus commitments when "Include commitment" is on) after
 *   this entry may not pass its budget, unless "Allow temporary overspending" lets it go up to the limit %.
 * Saving goes through approval (module `budget`) when it is On. A commitment can be marked Paid (also approval).
 */
const VALIDATION = 'Please correct the highlighted fields.';
const TYPES = [
  { value: 'ACTUAL', label: 'Actual Expense' },
  { value: 'COMMITMENT', label: 'Commitment (PO / PR)' },
];
const valuesOf = (l: { value: string }[]) => l.map((o) => o.value);
const numbered = <T extends object>(l: T[]) => l.map((o, i) => ({ id: i + 1, ...o }));
const OTHERS = valuesOf(OTHER_COST_CENTERS);
const pct = (a: number, b: number) => (b ? round2((a / b) * 100) : 0);
const isoDate = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' ? v.slice(0, 10) : '';

const schema = z.object({
  expenseDate: reqDate(),
  estate: text(26),
  department: oneOf(valuesOf(BUDGET_DEPARTMENTS)),
  costCenter: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? 'ALL_DIVISIONS' : v),
    text(26),
  ),
  head: oneOf(valuesOf(BUDGET_HEADS)),
  subHead: optText(60),
  type: oneOf(valuesOf(TYPES)),
  referenceNo: optText(60),
  amount: num('Must be more than 0.')
    .refine((v) => v > 0, 'Must be more than 0.')
    .refine((v) => v < 1e13, 'Too large.'),
  description: longText(),
  attachments: list(),
});

export interface ControlInput {
  estate: string;
  date: string;
  department: string;
  head: string;
  amount: number;
  type: string;
  exclude?: string;
}

/** The Budget Control answer for one entry: the numbers, the level and (when refused) the field and reason. */
export async function budgetControl(input: ControlInput) {
  const s = await budgetSettings();
  const fy = financialYearOf(input.date, s.yearStartMonth);
  const budgets = await db.budget.findMany({
    where: { estate: input.estate, financialYear: fy, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      budgetCode: true,
      status: true,
      lines: { where: { department: input.department, head: input.head }, select: { annualAmount: true } },
    },
  });
  const approved = budgets.find((b) => b.status === 'APPROVED');
  const budget = s.approvedBudgetOnly ? approved : (approved ?? budgets.find((b) => b.status !== 'REJECTED'));
  const headBudget = round2(budget?.lines.reduce((t, l) => t + Number(l.annualAmount), 0) ?? 0);
  const spent = spentOf(await spending(input.estate, fy, input.exclude), {
    estate: input.estate,
    financialYear: fy,
    department: input.department,
    head: input.head,
  });
  const used = round2(spent.actual + (s.includeCommitment ? spent.commitment : 0));
  const counts = input.type === 'ACTUAL' || s.includeCommitment;
  const after = round2(used + (counts ? input.amount : 0));
  const ceiling = round2(headBudget * (1 + (s.allowOverspending ? s.overspendingLimit : 0) / 100));
  const utilization = pct(after, headBudget);
  let problem: { field: string; message: string } | null = null;
  const fyText = fyLabel(fy);
  if (!budget) {
    if (s.approvedBudgetOnly && budgets.length)
      problem = {
        field: 'expenseDate',
        message: `Only approved budgets accept expenses: ${budgets[0]?.budgetCode} (${fyText}) is ${statusLabel(budgets[0]?.status)}.`,
      };
    else if (s.approvedBudgetOnly || s.requireBudgetCheck)
      problem = {
        field: 'expenseDate',
        message: `There is no ${s.approvedBudgetOnly ? 'approved ' : ''}budget for this estate in ${fyText}.`,
      };
  } else if (!headBudget && s.requireBudgetCheck)
    problem = {
      field: 'head',
      message: `${labelIn(BUDGET_DEPARTMENTS, input.department)} has no budget for ${headOf(input.head)?.label ?? input.head} in ${budget.budgetCode}.`,
    };
  else if (s.enforceBudgetLimit && counts && headBudget && after > headBudget && after > ceiling)
    problem = {
      field: 'amount',
      message: s.allowOverspending
        ? `Over the budget by more than the ${s.overspendingLimit}% allowed: ${after.toLocaleString('en-IN')} of ${headBudget.toLocaleString('en-IN')} taka.`
        : `Over the budget: ${after.toLocaleString('en-IN')} of ${headBudget.toLocaleString('en-IN')} taka (${round2(headBudget - used).toLocaleString('en-IN')} left).`,
    };
  const level = !headBudget
    ? 'NO_BUDGET'
    : utilization > s.overBudgetThreshold
      ? 'OVER_BUDGET'
      : utilization >= s.criticalThreshold
        ? 'CRITICAL'
        : utilization >= s.warningThreshold
          ? 'WARNING'
          : 'OK';
  return {
    financialYear: fy,
    financialYearLabel: fyText,
    budget: budget
      ? {
          id: budget.id,
          budgetCode: budget.budgetCode,
          status: budget.status,
          statusLabel: statusLabel(budget.status),
        }
      : null,
    headBudget,
    actual: round2(spent.actual),
    commitment: round2(spent.commitment),
    includeCommitment: s.includeCommitment,
    used,
    remaining: round2(headBudget - used),
    thisEntry: round2(input.amount),
    counted: counts,
    afterThisEntry: after,
    remainingAfter: round2(headBudget - after),
    utilization,
    level,
    levelLabel: {
      OK: 'Within Budget',
      WARNING: 'Warning',
      CRITICAL: 'Critical',
      OVER_BUDGET: 'Over Budget',
      NO_BUDGET: 'No Budget',
    }[level],
    overspending: Boolean(headBudget && after > headBudget && !problem),
    allowed: !problem,
    problem,
  };
}

async function nextCode(financialYear: string) {
  const s = await budgetSettings();
  const n = s.numbering.find((x) => x.docType === 'EXPENSE') ?? {
    docType: 'EXPENSE',
    prefix: 'EXP',
    digits: 4,
  };
  const year = Number(financialYear.slice(0, 4));
  const start = `${n.prefix}-${year}-`;
  const rows = await db.budgetExpense.findMany({
    where: { code: { startsWith: start } },
    select: { code: true },
  });
  return codeOf(
    n,
    year,
    rows.reduce((top, r) => Math.max(top, Number(r.code.slice(start.length)) || 0), 0) + 1,
  );
}

const monthWhere = (v: string) => {
  if (!/^\d{4}-\d{2}$/.test(v)) return { id: '__none__' };
  const [y, m] = v.split('-').map(Number) as [number, number];
  return { expenseDate: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } };
};
const statusOf = (r: Record<string, unknown>) =>
  r.type === 'COMMITMENT' ? 'OPEN' : r.paidDate ? 'PAID' : 'ACTUAL';
const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open Commitment',
  PAID: 'Paid (from commitment)',
  ACTUAL: 'Actual',
};

export const budgetExpensesRouter = defineResource('/budget-expenses', {
  name: 'budgetExpense',
  label: 'Budget expense',
  module: 'budget',
  page: 'Expense Entry',
  describe: (r) => show(r.code, paren(r.referenceNo)),
  model: 'budgetExpense',
  schema,
  search: ['code', 'referenceNo', 'description'],
  filters: [
    'estate',
    'financialYear',
    'department',
    'head',
    'type',
    'costCenter',
    { name: 'month', where: monthWhere },
  ],
  refs: { estate: { model: 'estate', label: 'estateName' } },
  files: ['attachments'],
  orderBy: [{ expenseDate: 'desc' }, { code: 'desc' }, { id: 'asc' }],
  check: async (values, id) => {
    const fields: Record<string, string> = {};
    const estate = await db.estate.findFirst({
      where: { id: String(values.estate), deletedAt: null },
      select: { id: true },
    });
    if (!estate) fields.estate = 'Select an estate.';
    const date = isoDate(values.expenseDate);
    if (date > todayDhaka()) fields.expenseDate = 'The date cannot be in the future.';
    if (estate && typeof values.costCenter === 'string' && !OTHERS.includes(values.costCenter)) {
      const d = await db.division.findFirst({
        where: { id: values.costCenter, estate: estate.id, deletedAt: null },
        select: { id: true },
      });
      if (!d) fields.costCenter = 'Select a division of this estate or another cost center from the list.';
    }
    if (values.subHead !== null && values.subHead !== undefined && !subHeadOf(values.head, values.subHead))
      fields.subHead = 'Select a sub head of this budget head.';
    Object.assign(fields, await attachmentProblems(values.attachments));
    if (id) {
      const before = await db.budgetExpense.findFirst({
        where: { id, deletedAt: null },
        select: { paidDate: true },
      });
      if (before?.paidDate && values.type === 'COMMITMENT')
        fields.type = 'This commitment is already Paid: it stays an actual expense.';
    }
    if (!Object.keys(fields).length) {
      const c = await budgetControl({
        estate: String(values.estate),
        date,
        department: String(values.department),
        head: String(values.head),
        amount: Number(values.amount),
        type: String(values.type),
        exclude: id,
      });
      if (c.problem) fields[c.problem.field] = c.problem.message;
    }
    return fields;
  },
  onSave: async (values) => {
    const s = await budgetSettings();
    const fy = financialYearOf(isoDate(values.expenseDate), s.yearStartMonth);
    const c = await budgetControl({
      estate: String(values.estate),
      date: isoDate(values.expenseDate),
      department: String(values.department),
      head: String(values.head),
      amount: 0,
      type: 'ACTUAL',
    });
    return {
      financialYear: fy,
      category: headOf(values.head)?.category ?? 'OPEX',
      budget: c.budget?.id ?? null,
    };
  },
  onCreate: async (values) => ({ code: await nextCode(String(values.financialYear)) }),
  extend: (row) => ({
    expenseDate: isoDate(row.expenseDate),
    paidDate: row.paidDate ? isoDate(row.paidDate) : null,
    financialYearLabel: fyLabel(String(row.financialYear)),
    departmentLabel: labelIn(BUDGET_DEPARTMENTS, row.department),
    headLabel: headOf(row.head)?.label ?? null,
    subHeadLabel: subHeadOf(row.head, row.subHead)?.label ?? null,
    categoryLabel: CATEGORY_LABELS[String(row.category)] ?? null,
    typeLabel: labelIn(TYPES, row.type),
    status: statusOf(row),
    statusLabel: STATUS_LABELS[statusOf(row)],
    canMarkPaid: row.type === 'COMMITMENT',
  }),
  enrich: async (rows) => {
    const ids = [...new Set(rows.map((r) => String(r.costCenter)).filter((v) => !OTHERS.includes(v)))];
    const divisions = new Map(
      ids.length
        ? (
            await db.division.findMany({
              where: { id: { in: ids } },
              select: { id: true, divisionName: true },
            })
          ).map((d) => [d.id, d.divisionName])
        : [],
    );
    const budgets = new Map(
      (
        await db.budget.findMany({
          where: { id: { in: rows.map((r) => String(r.budget)).filter((v) => v !== 'null') } },
          select: { id: true, budgetCode: true },
        })
      ).map((b) => [b.id, b.budgetCode]),
    );
    return new Map(
      rows.map((r) => [
        String(r.id),
        {
          costCenterLabel:
            labelIn(OTHER_COST_CENTERS, r.costCenter) ?? divisions.get(String(r.costCenter)) ?? null,
          budgetCode: budgets.get(String(r.budget)) ?? null,
        },
      ]),
    );
  },
  summary: async (where) => {
    const g = await db.budgetExpense.groupBy({
      by: ['type'],
      where: { ...(where as object), deletedAt: null },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const of = (t: string) => g.find((x) => x.type === t);
    const actual = round2(Number(of('ACTUAL')?._sum.amount ?? 0));
    const commitment = round2(Number(of('COMMITMENT')?._sum.amount ?? 0));
    return {
      totalEntries: g.reduce((t, x) => t + x._count._all, 0),
      actualExpense: actual,
      openCommitment: commitment,
      total: round2(actual + commitment),
      openCommitments: of('COMMITMENT')?._count._all ?? 0,
    };
  },
  export: {
    fileName: 'budget-expenses',
    sheet: 'Expenses',
    columns: [
      { header: 'SL', value: (_r, i) => i + 1, width: 6 },
      { header: 'Code', value: (r) => r.code, width: 16 },
      { header: 'Date', value: (r) => r.expenseDate, width: 12 },
      { header: 'Estate', value: (r) => r.estateName, width: 22 },
      { header: 'Department', value: (r) => r.departmentLabel, width: 28 },
      { header: 'Division / Cost Center', value: (r) => r.costCenterLabel, width: 20 },
      { header: 'Budget Head', value: (r) => r.headLabel, width: 24 },
      { header: 'Sub Head', value: (r) => r.subHeadLabel, width: 20 },
      { header: 'Category', value: (r) => r.category, width: 9 },
      { header: 'Type', value: (r) => r.typeLabel, width: 20 },
      { header: 'Reference No.', value: (r) => r.referenceNo, width: 16 },
      { header: 'Amount (৳)', value: (r) => Number(r.amount), width: 16, numFmt: '#,##0.00' },
      { header: 'Status', value: (r) => r.statusLabel, width: 20 },
      { header: 'Description', value: (r) => r.description, width: 32 },
    ],
  },
});

// ---- Mark Paid: a commitment becomes an actual expense (through approval) -----------------------------------------

const markPaidSchema = z.object({ paidDate: reqDate(), referenceNo: optText(60) });
const markPaid = defineCustomWrite({
  key: 'budgetExpenseMarkPaid',
  module: 'budget',
  resource: 'budgetExpense',
  page: 'Expense Entry',
  plan: async ({ params, body }) => {
    const parsed = markPaidSchema.safeParse(body ?? {});
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const i of parsed.error.issues) fields[i.path.join('.')] ??= i.message;
      throw new AppError('VALIDATION', VALIDATION, fields);
    }
    const row = await db.budgetExpense.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!row) throw notFound('Expense');
    if (row.type !== 'COMMITMENT')
      throw new AppError('VALIDATION', 'Only an open commitment can be marked Paid.', {
        type: 'Only an open commitment can be marked Paid.',
      });
    const paid = parsed.data.paidDate.toISOString().slice(0, 10);
    if (paid < isoDate(row.expenseDate))
      throw new AppError('VALIDATION', VALIDATION, { paidDate: 'Cannot be before the commitment date.' });
    if (paid > todayDhaka())
      throw new AppError('VALIDATION', VALIDATION, { paidDate: 'The date cannot be in the future.' });
    // Not counted before (Include commitment off): becoming actual must fit the budget.
    const c = await budgetControl({
      estate: row.estate,
      date: isoDate(row.expenseDate),
      department: row.department,
      head: row.head,
      amount: Number(row.amount),
      type: 'ACTUAL',
      exclude: row.id,
    });
    if (c.problem && c.problem.field === 'amount')
      throw new AppError('VALIDATION', c.problem.message, { amount: c.problem.message });
    const oldData = toJson({
      type: row.type,
      paidDate: null,
      referenceNo: row.referenceNo,
      updatedAt: row.updatedAt,
    });
    const data = {
      type: 'ACTUAL',
      paidDate: parsed.data.paidDate,
      referenceNo: parsed.data.referenceNo ?? row.referenceNo,
    };
    return {
      recordId: row.id,
      summary: `${row.code}: mark Paid`,
      oldData,
      newData: { ...data, paidDate: paid },
      run: async (tx, userId, approvalId) => {
        await tx.budgetExpense.update({ where: { id: row.id }, data: { ...data, updatedBy: userId } });
        await writeHistory(tx, {
          resource: 'budgetExpense',
          recordId: row.id,
          action: 'update',
          oldData: { type: row.type, paidDate: null, referenceNo: row.referenceNo },
          newData: { ...data, paidDate: paid },
          userId,
          approvalId,
        });
      },
    };
  },
});

export const budgetExpenseExtrasRouter = Router();

budgetExpenseExtrasRouter.get('/filter-options', async (_req, res) => {
  const s = await budgetSettings();
  res.json({
    types: numbered(TYPES),
    statuses: numbered(Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))),
    departments: numbered(BUDGET_DEPARTMENTS),
    defaultFinancialYear: s.defaultFinancialYear,
    financialYearRange: financialYearRange(s.defaultFinancialYear, s.yearStartMonth),
    budgetControl: {
      enforceBudgetLimit: s.enforceBudgetLimit,
      includeCommitment: s.includeCommitment,
      requireBudgetCheck: s.requireBudgetCheck,
      approvedBudgetOnly: s.approvedBudgetOnly,
      allowOverspending: s.allowOverspending,
      overspendingLimit: s.overspendingLimit,
    },
    attachmentTypes: ['PDF', 'XLSX', 'JPG', 'PNG'],
  });
});

budgetExpenseExtrasRouter.get('/next-code', async (req, res) => {
  const s = await budgetSettings();
  const date =
    typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : todayDhaka();
  res.json({ code: await nextCode(financialYearOf(date, s.yearStartMonth)) });
});

/** The form's Budget Check box: `?estate=&date=&department=&head=&amount=&type=&exclude=`. */
budgetExpenseExtrasRouter.get('/budget-check', async (req, res) => {
  const q = (k: string) => (typeof req.query[k] === 'string' ? req.query[k].trim() : '');
  const fields: Record<string, string> = {};
  if (!q('estate')) fields.estate = 'Select an estate.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q('date'))) fields.date = 'Use the format YYYY-MM-DD.';
  if (!valuesOf(BUDGET_DEPARTMENTS).includes(q('department')))
    fields.department = 'Select a value from the list.';
  if (!valuesOf(BUDGET_HEADS).includes(q('head'))) fields.head = 'Select a value from the list.';
  const amount = q('amount') === '' ? 0 : Number(q('amount'));
  if (!(amount >= 0)) fields.amount = 'Must be 0 or more.';
  const type = q('type') || 'ACTUAL';
  if (!valuesOf(TYPES).includes(type)) fields.type = 'Select a value from the list.';
  if (Object.keys(fields).length) throw new AppError('VALIDATION', VALIDATION, fields);
  res.json(
    await budgetControl({
      estate: q('estate'),
      date: q('date'),
      department: q('department'),
      head: q('head'),
      amount,
      type,
      exclude: q('exclude') || undefined,
    }),
  );
});

budgetExpenseExtrasRouter.post('/:id/mark-paid', async (req, res) => {
  const { queued } = await runCustomWrite(
    markPaid,
    { params: { id: req.params.id }, body: req.body, action: 'update' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  const row = await db.budgetExpense.findUnique({
    where: { id: req.params.id },
    select: { id: true, code: true, type: true, paidDate: true },
  });
  res.json({ ...row, paidDate: row?.paidDate ? isoDate(row.paidDate) : null });
});

const doc = (summary: string, method: 'get' | 'post' = 'get') => ({
  [method]: { tags: ['Budget'], summary, responses: { '200': { description: 'ok' } } },
});
docsPaths['/budget-expenses/filter-options'] = doc('Expense Entry lists and Budget Control settings');
docsPaths['/budget-expenses/next-code'] = doc('Next EXP code for ?date=');
docsPaths['/budget-expenses/budget-check'] = doc(
  'Budget Check of an entry: ?estate=&date=&department=&head=&amount=&type=&exclude=',
);
docsPaths['/budget-expenses/{id}/mark-paid'] = doc(
  'Mark a commitment Paid: { paidDate, referenceNo? } (approval when On)',
  'post',
);
