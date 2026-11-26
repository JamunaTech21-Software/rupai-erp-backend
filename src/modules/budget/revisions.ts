import { join } from 'node:path';

import ExcelJS from 'exceljs';
import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { list, longText, oneOf, optText, ref, reqDate, signedNum, text } from '../../lib/fields.js';
import { type Tx, writeHistory } from '../../lib/history.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { uploadRoot } from '../files/service.js';
import {
  MONTH_SHORT,
  attachmentProblems,
  cellValue,
  methodPercents,
  monthAmounts,
  norm,
  round2,
} from './budgets.js';
import { BUDGET_DEPARTMENTS, BUDGET_HEADS, CATEGORY_LABELS, headOf, labelIn } from './heads.js';
import { changeHead, nextPosition } from './headChanges.js';
import { budgetSettings, codeOf, fyLabel } from './settings.js';
import { spending, spentOf } from './spending.js';
import { EDITABLE, STATUSES, registerWorkflowDoc, statusLabel, workflowView } from './workflow.js';

/**
 * RP1-258 B.8 Budget Revision (`/budget-revision`, `images/9.jpeg`): `/budget-revisions`. A revision of one
 * department and category of an Approved annual budget. Lines: head and a signed change (`revisionAmount`):
 * Increase all >= 0, Decrease all <= 0, Reallocation adds up to 0. A head may be new in the department only for an
 * Increase or Reallocation (it gets a new budget line, All Divisions, Settings allocation). A head cannot go below
 * 0 nor below its actual + commitment (Expense Entry). Budget workflow `REVISION`; on the last approval the changes
 * go into the budget lines (spread over the department's lines of the head by their amounts; each line keeps its
 * monthly %), the original amounts are kept on the revision lines and the budget's edit log gets an entry.
 */
const VALIDATION = 'Please correct the highlighted fields.';
const TYPES = [
  { value: 'INCREASE', label: 'Increase' },
  { value: 'DECREASE', label: 'Decrease' },
  { value: 'REALLOCATION', label: 'Reallocation' },
];
const CATEGORIES = [
  { value: 'OPEX', label: 'OPEX (Operational)' },
  { value: 'CAPEX', label: 'CAPEX (Capital)' },
];
const valuesOf = (l: { value: string }[]) => l.map((o) => o.value);
const numbered = <T extends object>(l: T[]) => l.map((o, i) => ({ id: i + 1, ...o }));
const sum = (l: number[]) => round2(l.reduce((s, v) => s + v, 0));
const pct = (a: number, b: number) => (b ? round2((a / b) * 100) : a ? 100 : 0);
const isoDate = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' ? v.slice(0, 10) : '';
const money = (v: number) => v.toLocaleString('en-IN');

const lineSchema = z.object({
  head: oneOf(valuesOf(BUDGET_HEADS)),
  revisionAmount: signedNum().refine((v) => Math.abs(v) < 1e13, 'Too large.'),
  remarks: optText(250),
});
const schema = z.object({
  budget: ref(),
  department: oneOf(valuesOf(BUDGET_DEPARTMENTS)),
  category: oneOf(valuesOf(CATEGORIES)),
  revisionType: oneOf(valuesOf(TYPES)),
  title: text(150),
  revisionDate: reqDate(),
  justification: longText(),
  remarks: longText(),
  attachments: list(),
});

interface RLine {
  head: string;
  revisionAmount: number;
  remarks?: string | null;
}

async function approvedBudget(id: string) {
  return db.budget.findFirst({
    where: { id, deletedAt: null },
    include: { lines: { orderBy: { position: 'asc' } } },
  });
}
type FullBudget = NonNullable<Awaited<ReturnType<typeof approvedBudget>>>;

/** Net change of the department's approved revisions of this budget (other than `exclude`). */
async function previousRevisions(budgetId: string, department: string, exclude?: string) {
  const rows = await db.budgetRevisionLine.findMany({
    where: {
      revision: {
        budget: budgetId,
        department,
        status: 'APPROVED',
        deletedAt: null,
        ...(exclude ? { NOT: { id: exclude } } : {}),
      },
    },
    select: { revisionAmount: true },
  });
  return sum(rows.map((r) => Number(r.revisionAmount)));
}

/** Line rules (keys `lines`, `lines.<i>.*`) against the budget as it is now. */
async function lineProblems(
  b: FullBudget,
  department: string,
  category: string,
  type: string,
  lines: RLine[],
) {
  const fields: Record<string, string> = {};
  if (!lines.length) return { lines: 'Add at least one budget line.' };
  const spent = await spending(b.estate, b.financialYear);
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    const head = headOf(l.head);
    if (!head) return;
    if (seen.has(l.head)) return void (fields[`lines.${i}.head`] = 'This budget head is in the list twice.');
    seen.add(l.head);
    if (head.category !== category)
      return void (fields[`lines.${i}.head`] =
        `${head.label} is ${head.category}; this revision is ${category}.`);
    const original = sum(
      b.lines
        .filter((x) => x.department === department && x.head === l.head)
        .map((x) => Number(x.annualAmount)),
    );
    const revised = round2(original + l.revisionAmount);
    if (type === 'INCREASE' && l.revisionAmount < 0)
      fields[`lines.${i}.revisionAmount`] = 'An Increase cannot lower a head (use 0 or more).';
    else if (type === 'DECREASE' && l.revisionAmount > 0)
      fields[`lines.${i}.revisionAmount`] = 'A Decrease cannot raise a head (use a minus amount or 0).';
    else if (type === 'DECREASE' && !original)
      fields[`lines.${i}.head`] = 'This head has no budget in the department to decrease.';
    else if (revised < 0)
      fields[`lines.${i}.revisionAmount`] =
        `The revised budget cannot be below 0 (original ${money(original)}).`;
    else {
      const s = spentOf(spent, {
        estate: b.estate,
        financialYear: b.financialYear,
        department,
        head: l.head,
      });
      const used = round2(s.actual + s.commitment);
      if (l.revisionAmount < 0 && revised < used)
        fields[`lines.${i}.revisionAmount`] =
          `Cannot go below the actual + commitment of ${money(used)} (revised would be ${money(revised)}).`;
    }
  });
  if (Object.keys(fields).length) return fields;
  const net = sum(lines.map((l) => l.revisionAmount));
  if (type === 'REALLOCATION' && Math.abs(net) >= 0.01)
    fields.lines = `Reallocation lines must add up to 0 (now ${money(net)}).`;
  else if (type === 'REALLOCATION' && lines.every((l) => !l.revisionAmount))
    fields.lines = 'Move an amount from one head to another.';
  else if (type === 'INCREASE' && net <= 0) fields.lines = 'An Increase needs at least one amount above 0.';
  else if (type === 'DECREASE' && net >= 0) fields.lines = 'A Decrease needs at least one amount below 0.';
  return fields;
}

/** Lines with original / revised / change %, totals, Budget Comparison, Monthly Impact and trend. */
async function impact(
  b: FullBudget,
  department: string,
  lines: RLine[],
  opts: { exclude?: string; originals?: Map<string, number> } = {},
) {
  const settings = await budgetSettings();
  const deptLines = b.lines.filter((x) => x.department === department);
  const rows = lines.map((l, i) => {
    const mine = deptLines.filter((x) => x.head === l.head);
    const original = opts.originals?.get(l.head) ?? sum(mine.map((x) => Number(x.annualAmount)));
    const revised = round2(original + l.revisionAmount);
    const months = Array.from({ length: 12 }, (_, m) =>
      sum(mine.map((x) => Number((x.monthAmounts as number[])[m] ?? 0))),
    );
    const base = sum(months);
    const percents = base
      ? months.map((v) => (v / base) * 100)
      : methodPercents(settings.allocationMethod, settings.seasonalPercents);
    return {
      position: i,
      head: l.head,
      headLabel: headOf(l.head)?.label ?? l.head,
      category: headOf(l.head)?.category ?? null,
      categoryLabel: headOf(l.head)?.category ?? null,
      originalAmount: original,
      revisionAmount: round2(l.revisionAmount),
      revisedAmount: revised,
      changePercent: pct(l.revisionAmount, original),
      remarks: l.remarks ?? null,
      newHead: !mine.length,
      originalMonths: months,
      revisionMonths: monthAmounts(l.revisionAmount, percents),
    };
  });
  const totalOriginal = sum(rows.map((r) => r.originalAmount));
  const totalRevision = sum(rows.map((r) => r.revisionAmount));
  const deptTotal = sum(deptLines.map((x) => Number(x.annualAmount)));
  const previous = await previousRevisions(b.id, department, opts.exclude);
  const current = opts.originals ? round2(deptTotal - totalRevision) : deptTotal; // department total before this revision
  const originalApproved = round2(current - previous);
  const revisedBudget = round2(current + totalRevision);
  const monthlyImpact = MONTH_SHORT.map((label, m) => {
    const original = sum(rows.map((r) => r.originalMonths[m] ?? 0));
    const revision = sum(rows.map((r) => r.revisionMonths[m] ?? 0));
    return { month: m + 1, label, original, revision, revised: round2(original + revision) };
  });
  return {
    lines: rows.map(({ originalMonths: _o, revisionMonths: _r, ...r }) => r),
    totals: {
      originalAmount: totalOriginal,
      revisionAmount: totalRevision,
      revisedAmount: round2(totalOriginal + totalRevision),
      changePercent: pct(totalRevision, totalOriginal),
    },
    comparison: {
      department,
      departmentLabel: labelIn(BUDGET_DEPARTMENTS, department),
      originalApprovedBudget: originalApproved,
      totalPreviousRevision: previous,
      currentRevision: totalRevision,
      revisedBudget,
      changePercent: pct(revisedBudget - originalApproved, originalApproved),
    },
    monthlyImpact,
    monthlyImpactTotal: {
      original: sum(monthlyImpact.map((m) => m.original)),
      revision: sum(monthlyImpact.map((m) => m.revision)),
      revised: sum(monthlyImpact.map((m) => m.revised)),
    },
    trend: monthlyImpact.map((m) => ({
      month: m.month,
      label: m.label,
      original: m.original,
      revised: m.revised,
    })),
  };
}

async function nextNumbers(budgetId: string, financialYear: string) {
  const s = await budgetSettings();
  const n = s.numbering.find((x) => x.docType === 'REVISION') ?? {
    docType: 'REVISION',
    prefix: 'REV',
    digits: 4,
  };
  const year = Number(financialYear.slice(0, 4));
  const start = `${n.prefix}-${year}-`;
  const rows = await db.budgetRevision.findMany({
    where: { code: { startsWith: start } },
    select: { code: true },
  });
  const code = codeOf(
    n,
    year,
    rows.reduce((top, r) => Math.max(top, Number(r.code.slice(start.length)) || 0), 0) + 1,
  );
  const mine = await db.budgetRevision.findMany({
    where: { budget: budgetId },
    select: { revisionNo: true },
  });
  const no = mine.reduce((top, r) => Math.max(top, Number(r.revisionNo.slice(2)) || 0), 0) + 1;
  return { code, revisionNo: `R-${String(no).padStart(2, '0')}` };
}

const asLines = (rows: unknown[] | undefined): RLine[] =>
  ((rows ?? []) as Record<string, unknown>[]).map((r) => ({
    head: String(r.head),
    revisionAmount: Number(r.revisionAmount),
    remarks: (r.remarks as string | null) ?? null,
  }));

export const budgetRevisionsRouter = defineResource('/budget-revisions', {
  name: 'budgetRevision',
  label: 'Budget revision',
  module: 'budget',
  page: 'Budget Revision',
  describe: (r) => show(r.code, paren(r.title)),
  model: 'budgetRevision',
  schema,
  search: ['code', 'title', 'revisionNo'],
  filters: ['estate', 'financialYear', 'budget', 'department', 'category', 'revisionType', 'status'],
  refs: { estate: { model: 'estate', label: 'estateName' } },
  files: ['attachments'],
  children: [
    {
      key: 'lines',
      model: 'budgetRevisionLine',
      parentKey: 'revisionId',
      schema: lineSchema,
      decorate: async (rows, parent) => {
        const b = await approvedBudget(String(parent.budget));
        if (!b) return rows;
        const originals =
          parent.status === 'APPROVED'
            ? new Map(rows.map((r) => [String(r.head), Number(r.originalAmount ?? 0)]))
            : undefined;
        const im = await impact(b, String(parent.department), asLines(rows), {
          exclude: String(parent.id),
          originals,
        });
        return rows.map((r, i) => ({ ...r, ...im.lines[i], id: r.id, position: r.position }));
      },
    },
  ],
  orderBy: [{ financialYear: 'desc' }, { code: 'desc' }, { id: 'asc' }],
  skipApproval: () => true,
  check: async (values, id, rows) => {
    const fields: Record<string, string> = {};
    if (id) {
      const before = await db.budgetRevision.findFirst({
        where: { id, deletedAt: null },
        select: { status: true, budget: true },
      });
      if (before && !EDITABLE.includes(before.status))
        fields.status = `This revision is ${statusLabel(before.status)}: only a Draft or Returned one can be edited.`;
      if (before && before.budget !== values.budget)
        fields.budget = 'The budget of a revision cannot be changed.';
    }
    const b = await approvedBudget(String(values.budget));
    if (!b) fields.budget = 'Select an annual budget.';
    else if (b.status !== 'APPROVED')
      fields.budget = `${b.budgetCode} is ${statusLabel(b.status)}: only an Approved budget can be revised.`;
    Object.assign(fields, await attachmentProblems(values.attachments));
    if (b && !fields.budget)
      Object.assign(
        fields,
        await lineProblems(
          b,
          String(values.department),
          String(values.category),
          String(values.revisionType),
          asLines(rows?.lines),
        ),
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
  onCreate: async (values) => ({
    ...(await nextNumbers(String(values.budget), String(values.financialYear))),
    status: 'DRAFT',
  }),
  extend: (row) => ({
    revisionDate: isoDate(row.revisionDate),
    financialYearLabel: fyLabel(String(row.financialYear)),
    departmentLabel: labelIn(BUDGET_DEPARTMENTS, row.department),
    categoryLabel: labelIn(CATEGORIES, row.category),
    revisionTypeLabel: labelIn(TYPES, row.revisionType),
    statusLabel: statusLabel(row.status),
    preparedBy: row.createdBy,
    editable: EDITABLE.includes(String(row.status)),
  }),
  enrich: async (rows) => {
    const budgets = new Map(
      (
        await db.budget.findMany({
          where: { id: { in: [...new Set(rows.map((r) => String(r.budget)))] } },
          select: { id: true, budgetCode: true, budgetName: true },
        })
      ).map((b) => [b.id, b]),
    );
    const lines = await db.budgetRevisionLine.findMany({
      where: { revisionId: { in: rows.map((r) => String(r.id)) } },
      select: { revisionId: true, revisionAmount: true },
    });
    return new Map(
      rows.map((r) => [
        String(r.id),
        {
          budgetCode: budgets.get(String(r.budget))?.budgetCode ?? null,
          budgetName: budgets.get(String(r.budget))?.budgetName ?? null,
          totalRevision: sum(lines.filter((l) => l.revisionId === r.id).map((l) => Number(l.revisionAmount))),
          totalLines: lines.filter((l) => l.revisionId === r.id).length,
        },
      ]),
    );
  },
  deleteCheck: (row) =>
    Promise.resolve(
      EDITABLE.includes(String(row.status)) || row.status === 'REJECTED'
        ? undefined
        : `This revision is ${statusLabel(row.status)}: only a Draft, Returned or Rejected one can be deleted.`,
    ),
  export: {
    fileName: 'budget-revisions',
    sheet: 'Budget Revisions',
    columns: [
      { header: 'SL', value: (_r, i) => i + 1, width: 6 },
      { header: 'Revision Code', value: (r) => r.code, width: 18 },
      { header: 'Revision No.', value: (r) => r.revisionNo, width: 10 },
      { header: 'Budget', value: (r) => r.budgetCode, width: 16 },
      { header: 'Financial Year', value: (r) => r.financialYearLabel, width: 14 },
      { header: 'Estate', value: (r) => r.estateName, width: 22 },
      { header: 'Department', value: (r) => r.departmentLabel, width: 28 },
      { header: 'Category', value: (r) => r.categoryLabel, width: 18 },
      { header: 'Type', value: (r) => r.revisionTypeLabel, width: 14 },
      { header: 'Title', value: (r) => r.title, width: 32 },
      { header: 'Date', value: (r) => r.revisionDate, width: 12 },
      { header: 'Change (৳)', value: (r) => r.totalRevision, width: 16, numFmt: '#,##0' },
      { header: 'Status', value: (r) => r.statusLabel, width: 12 },
    ],
  },
  options: {
    path: 'budget-revisions',
    label: (row) => `${String(row.code)} — ${String(row.title)}`,
    filters: ['budget', 'status'],
  },
});

async function savedLines(id: string): Promise<RLine[]> {
  return (
    await db.budgetRevisionLine.findMany({ where: { revisionId: id }, orderBy: { position: 'asc' } })
  ).map((l) => ({ head: l.head, revisionAmount: Number(l.revisionAmount), remarks: l.remarks }));
}

/** Writes a revision's changes into the budget lines (in the approval transaction). */
async function applyRevision(tx: Tx, row: Record<string, unknown>, userId: string) {
  const b = await approvedBudget(String(row.budget));
  const lines = await savedLines(String(row.id));
  if (!b || b.status !== 'APPROVED')
    throw new AppError('DUPLICATE', 'The annual budget is no longer Approved; reject this revision.');
  const problems = await lineProblems(
    b,
    String(row.department),
    String(row.category),
    String(row.revisionType),
    lines,
  );
  if (Object.keys(problems).length)
    throw new AppError(
      'DUPLICATE',
      `This revision no longer fits the budget: ${Object.values(problems)[0]} Return it to the preparer.`,
      problems,
    );
  const department = String(row.department);
  const before = b.lines
    .filter((l) => l.department === department)
    .map((l) => ({ id: l.id, head: l.head, annualAmount: Number(l.annualAmount) }));
  let position = nextPosition(b.lines);
  for (const l of lines) {
    const original = sum(
      b.lines
        .filter((x) => x.department === department && x.head === l.head)
        .map((x) => Number(x.annualAmount)),
    );
    await tx.budgetRevisionLine.updateMany({
      where: { revisionId: String(row.id), head: l.head },
      data: { originalAmount: original },
    });
    position = await changeHead(tx, b, department, l.head, l.revisionAmount, String(row.category), position);
  }
  await tx.budget.update({ where: { id: b.id }, data: { updatedAt: new Date(), updatedBy: userId } });
  await writeHistory(tx, {
    resource: 'budget',
    recordId: b.id,
    action: 'update',
    oldData: { department, lines: before },
    newData: {
      revision: String(row.code),
      revisionNo: String(row.revisionNo),
      changes: lines.map((l) => ({ head: l.head, revisionAmount: l.revisionAmount })),
    },
    userId,
    approvalId: null,
  });
}

registerWorkflowDoc({
  docType: 'REVISION',
  label: 'Budget revision',
  resource: 'budgetRevision',
  find: (id) => db.budgetRevision.findFirst({ where: { id } }),
  update: async (tx, id, from, data) =>
    (
      await tx.budgetRevision.updateMany({
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
    const b = await approvedBudget(String(row.budget));
    if (!b || b.status !== 'APPROVED') return 'The annual budget is no longer Approved.';
    const problems = await lineProblems(
      b,
      String(row.department),
      String(row.category),
      String(row.revisionType),
      await savedLines(String(row.id)),
    );
    const first = Object.values(problems)[0];
    return first ? `Check the lines first: ${first}` : undefined;
  },
  onApproved: applyRevision,
});

export const budgetRevisionExtrasRouter = Router();

budgetRevisionExtrasRouter.get('/filter-options', (_req, res) => {
  res.json({
    revisionTypes: numbered(TYPES),
    categories: numbered(CATEGORIES),
    departments: numbered(BUDGET_DEPARTMENTS),
    statuses: numbered(STATUSES),
    attachmentTypes: ['PDF', 'XLSX', 'JPG', 'PNG'],
  });
});

budgetRevisionExtrasRouter.get('/next-code', async (req, res) => {
  const b =
    typeof req.query.budget === 'string'
      ? await db.budget.findFirst({
          where: { id: req.query.budget, deletedAt: null },
          select: { id: true, financialYear: true },
        })
      : null;
  if (!b) throw new AppError('VALIDATION', VALIDATION, { budget: 'Select an annual budget.' });
  res.json(await nextNumbers(b.id, b.financialYear));
});

/** The department's heads of the category with their current amounts (the rows to pick from). */
budgetRevisionExtrasRouter.get('/department-heads', async (req, res) => {
  const q = (k: string) => (typeof req.query[k] === 'string' ? req.query[k].trim() : '');
  const b = await approvedBudget(q('budget'));
  if (!b) throw new AppError('VALIDATION', VALIDATION, { budget: 'Select an annual budget.' });
  const lines = b.lines.filter(
    (l) => l.department === q('department') && (!q('category') || l.category === q('category')),
  );
  const heads = [...new Set(lines.map((l) => l.head))].map((h) => ({
    head: h,
    headLabel: headOf(h)?.label ?? h,
    category: headOf(h)?.category ?? null,
    amount: sum(lines.filter((l) => l.head === h).map((l) => Number(l.annualAmount))),
  }));
  res.json({
    budget: { id: b.id, budgetCode: b.budgetCode, status: b.status, statusLabel: statusLabel(b.status) },
    estate: b.estate,
    financialYear: b.financialYear,
    heads,
  });
});

const previewSchema = z.object({
  budget: ref(),
  department: oneOf(valuesOf(BUDGET_DEPARTMENTS)),
  category: oneOf(valuesOf(CATEGORIES)),
  revisionType: oneOf(valuesOf(TYPES)),
  lines: z.array(lineSchema).max(200),
  exclude: z.string().optional(),
});

/** Budget Comparison, line figures and Monthly Impact before saving, with the rule problems (`problems`). */
budgetRevisionExtrasRouter.post('/preview', async (req, res) => {
  const p = previewSchema.safeParse(req.body ?? {});
  if (!p.success) {
    const fields: Record<string, string> = {};
    for (const i of p.error.issues) fields[i.path.join('.')] ??= i.message;
    throw new AppError('VALIDATION', VALIDATION, fields);
  }
  const b = await approvedBudget(p.data.budget);
  if (!b) throw notFound('Budget');
  const problems =
    b.status === 'APPROVED'
      ? await lineProblems(b, p.data.department, p.data.category, p.data.revisionType, p.data.lines)
      : { budget: `${b.budgetCode} is ${statusLabel(b.status)}.` };
  res.json({ ...(await impact(b, p.data.department, p.data.lines, { exclude: p.data.exclude })), problems });
});

budgetRevisionExtrasRouter.get('/:id/impact', async (req, res) => {
  const row = await db.budgetRevision.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: { lines: { orderBy: { position: 'asc' } } },
  });
  if (!row) throw notFound('Budget revision');
  const b = await approvedBudget(row.budget);
  if (!b) throw notFound('Budget');
  const originals =
    row.status === 'APPROVED'
      ? new Map(row.lines.map((l) => [l.head, Number(l.originalAmount ?? 0)]))
      : undefined;
  res.json(
    await impact(
      b,
      row.department,
      row.lines.map((l) => ({ head: l.head, revisionAmount: Number(l.revisionAmount), remarks: l.remarks })),
      { exclude: row.id, originals },
    ),
  );
});

budgetRevisionExtrasRouter.get('/:id/workflow', async (req, res) => {
  const row = await db.budgetRevision.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!row) throw notFound('Budget revision');
  res.json(await workflowView('REVISION', row));
});

budgetRevisionExtrasRouter.get('/import-template', async (req, res) => {
  const q = (k: string) => (typeof req.query[k] === 'string' ? req.query[k].trim() : '');
  const b = q('budget') ? await approvedBudget(q('budget')) : null;
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Revision Lines');
  sheet.addRow(['Budget Head', 'Revision Amount (৳)', 'Remarks']);
  sheet.getRow(1).font = { bold: true };
  const heads = [
    ...new Set(
      (b?.lines ?? [])
        .filter((l) => l.department === q('department') && (!q('category') || l.category === q('category')))
        .map((l) => l.head),
    ),
  ];
  for (const h of heads.length ? heads : ['FERTILIZER', 'PESTICIDE'])
    sheet.addRow([headOf(h)?.label ?? h, 0, '']);
  sheet.columns.forEach((c, i) => (c.width = i === 2 ? 40 : 26));
  res.setHeader('Content-Disposition', 'attachment; filename="budget-revision-lines.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(Buffer.from(await book.xlsx.writeBuffer()));
});

/** `POST /budget-revisions/import { file }` → `{ lines: [{ head, revisionAmount, remarks }] }` for the form (not saved). */
budgetRevisionExtrasRouter.post('/import', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
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
  const fields: Record<string, string> = {};
  const lines: RLine[] = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const v = (i: number) => cellValue(row.getCell(i).value);
    if (norm(v(1)) === '' && norm(v(2)) === '') return;
    const head = BUDGET_HEADS.find((h) => norm(h.label) === norm(v(1)) || norm(h.value) === norm(v(1)));
    if (!head) fields[`rows.${n}.head`] = 'Unknown budget head.';
    const amount = Number(v(2) ?? 0);
    if (!Number.isFinite(amount) || Math.abs(amount) >= 1e13)
      fields[`rows.${n}.revisionAmount`] = 'Must be a number.';
    const remarks = typeof v(3) === 'string' ? (v(3) as string).trim().slice(0, 250) : null;
    if (head && Number.isFinite(amount))
      lines.push({ head: head.value, revisionAmount: amount, remarks: remarks || null });
  });
  if (Object.keys(fields).length)
    throw new AppError('VALIDATION', 'Some rows of the file are wrong; nothing was read.', fields);
  if (!lines.length) throw new AppError('VALIDATION', VALIDATION, { file: 'The file has no lines.' });
  res.json({
    lines: lines.map((l) => ({
      ...l,
      headLabel: headOf(l.head)?.label ?? l.head,
      category: headOf(l.head)?.category ?? null,
      categoryLabel: CATEGORY_LABELS[headOf(l.head)?.category ?? ''] ?? null,
    })),
  });
});

const doc = (summary: string, method: 'get' | 'post' = 'get') => ({
  [method]: { tags: ['Budget'], summary, responses: { '200': { description: 'ok' } } },
});
docsPaths['/budget-revisions/filter-options'] = doc('Budget Revision lists');
docsPaths['/budget-revisions/next-code'] = doc('Next REV code and revision no. for ?budget=');
docsPaths['/budget-revisions/department-heads'] = doc(
  'Heads of ?budget=&department=&category= with their amounts',
);
docsPaths['/budget-revisions/preview'] = doc('Comparison, lines and Monthly Impact before saving', 'post');
docsPaths['/budget-revisions/{id}/impact'] = doc('Comparison, lines and Monthly Impact of a saved revision');
docsPaths['/budget-revisions/{id}/workflow'] = doc('Approval Workflow card of a revision');
docsPaths['/budget-revisions/import-template'] = doc(
  'Excel of revision lines: ?budget=&department=&category=',
);
docsPaths['/budget-revisions/import'] = doc('Read revision lines from Excel: { file }', 'post');
