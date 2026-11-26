import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { list, longText, num, oneOf, optText, reqDate, text } from '../../lib/fields.js';
import { type Tx, writeHistory } from '../../lib/history.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { todayDhaka } from '../weather/entries.js';
import { attachmentProblems, round2 } from './budgets.js';
import { changeHead, nextPosition } from './headChanges.js';
import { BUDGET_DEPARTMENTS, BUDGET_HEADS, headOf, labelIn, subHeadOf } from './heads.js';
import { budgetSettings, codeOf, fyLabel } from './settings.js';
import { spending, spentOf } from './spending.js';
import { EDITABLE, STATUSES, registerWorkflowDoc, statusLabel, workflowView } from './workflow.js';

/**
 * RP1-261 B.9 Budget Transfer (`/budget-transfer`, `images/7.jpeg`): `/budget-transfers`. Moves budget between
 * heads of one department in the estate's Approved budget for the financial year (Transfer Type Within
 * Department). Lines: from head / sub head → to head / sub head, amount, remarks. Each head's available = budget -
 * actual - committed (Expense Entry); what a head gives in all lines (less what it receives) cannot pass its
 * available. From and to are different heads of the same category (OPEX to CAPEX needs a Revision); the to head may
 * be new in the department. Net impact on the department is always 0. Budget workflow `TRANSFER`; the last
 * approval moves the amounts (monthly split in proportion), checked again first.
 */
const VALIDATION = 'Please correct the highlighted fields.';
const TYPES = [{ value: 'WITHIN_DEPARTMENT', label: 'Within Department' }];
const valuesOf = (l: { value: string }[]) => l.map((o) => o.value);
const numbered = <T extends object>(l: T[]) => l.map((o, i) => ({ id: i + 1, ...o }));
const sum = (l: number[]) => round2(l.reduce((s, v) => s + v, 0));
const isoDate = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' ? v.slice(0, 10) : '';
const money = (v: number) => v.toLocaleString('en-IN');

const lineSchema = z.object({
  fromHead: oneOf(valuesOf(BUDGET_HEADS)),
  fromSubHead: optText(60),
  toHead: oneOf(valuesOf(BUDGET_HEADS)),
  toSubHead: optText(60),
  amount: num('Must be more than 0.')
    .refine((v) => v > 0, 'Must be more than 0.')
    .refine((v) => v < 1e13, 'Too large.'),
  remarks: optText(250),
});
const schema = z.object({
  transferDate: reqDate(),
  financialYear: text(9),
  estate: text(26),
  department: oneOf(valuesOf(BUDGET_DEPARTMENTS)),
  transferType: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? 'WITHIN_DEPARTMENT' : v),
    oneOf(valuesOf(TYPES)),
  ),
  title: text(150),
  remarks: longText(),
  justification: text(5000),
  attachments: list(),
});

interface TLine {
  fromHead: string;
  fromSubHead?: string | null;
  toHead: string;
  toSubHead?: string | null;
  amount: number;
  remarks?: string | null;
}
const asLines = (rows: unknown[] | undefined): TLine[] =>
  ((rows ?? []) as Record<string, unknown>[]).map((r) => ({
    fromHead: String(r.fromHead),
    fromSubHead: (r.fromSubHead as string | null) ?? null,
    toHead: String(r.toHead),
    toSubHead: (r.toSubHead as string | null) ?? null,
    amount: Number(r.amount),
    remarks: (r.remarks as string | null) ?? null,
  }));

async function approvedBudgetOf(estate: string, financialYear: string) {
  return db.budget.findFirst({
    where: { estate, financialYear, status: 'APPROVED', deletedAt: null },
    include: { lines: { orderBy: { position: 'asc' } } },
  });
}
type FullBudget = NonNullable<Awaited<ReturnType<typeof approvedBudgetOf>>>;

/** Budget, actual, committed and available of each head of the department. */
async function positions(b: FullBudget, department: string, heads: string[]) {
  const spent = await spending(b.estate, b.financialYear);
  return heads.map((head) => {
    const budget = sum(
      b.lines
        .filter((l) => l.department === department && l.head === head)
        .map((l) => Number(l.annualAmount)),
    );
    const s = spentOf(spent, { estate: b.estate, financialYear: b.financialYear, department, head });
    return {
      head,
      headLabel: headOf(head)?.label ?? head,
      category: headOf(head)?.category ?? null,
      budget,
      actual: round2(s.actual),
      committed: round2(s.commitment),
      available: round2(budget - s.actual - s.commitment),
    };
  });
}
const headsOf = (lines: TLine[]) => [...new Set(lines.flatMap((l) => [l.fromHead, l.toHead]))];

/** Rules of the lines (`lines`, `lines.<i>.*`). */
async function lineProblems(b: FullBudget, department: string, lines: TLine[]) {
  const fields: Record<string, string> = {};
  if (!lines.length) return { lines: 'Add at least one transfer line.' };
  const pos = new Map((await positions(b, department, headsOf(lines))).map((p) => [p.head, p]));
  lines.forEach((l, i) => {
    const from = headOf(l.fromHead);
    const to = headOf(l.toHead);
    if (!from || !to) return;
    if (l.fromHead === l.toHead)
      fields[`lines.${i}.toHead`] = 'Pick a different budget head to receive the amount.';
    else if (from.category !== to.category)
      fields[`lines.${i}.toHead`] =
        `${from.label} is ${from.category} and ${to.label} is ${to.category}: move between categories with a Budget Revision.`;
    if (l.fromSubHead && !subHeadOf(l.fromHead, l.fromSubHead))
      fields[`lines.${i}.fromSubHead`] = 'Select a sub head of this budget head.';
    if (l.toSubHead && !subHeadOf(l.toHead, l.toSubHead))
      fields[`lines.${i}.toSubHead`] = 'Select a sub head of this budget head.';
    if (!pos.get(l.fromHead)?.budget)
      fields[`lines.${i}.fromHead`] =
        `${from.label} has no budget in ${labelIn(BUDGET_DEPARTMENTS, department)}.`;
  });
  if (Object.keys(fields).length) return fields;
  const net = new Map<string, number>();
  for (const l of lines) {
    net.set(l.fromHead, (net.get(l.fromHead) ?? 0) - l.amount);
    net.set(l.toHead, (net.get(l.toHead) ?? 0) + l.amount);
  }
  lines.forEach((l, i) => {
    const give = -(net.get(l.fromHead) ?? 0);
    const p = pos.get(l.fromHead);
    if (p && give > p.available + 0.001 && !fields[`lines.${i}.amount`])
      fields[`lines.${i}.amount`] =
        `${p.headLabel} has ${money(p.available)} available (budget ${money(p.budget)} - actual ${money(p.actual)} - committed ${money(p.committed)}); this transfer takes ${money(round2(give))}.`;
  });
  return fields;
}

/** Budget Position, lines with availability, Transfer Summary and Budget After Transfer. */
async function figures(b: FullBudget, department: string, lines: TLine[]) {
  const heads = headsOf(lines);
  const pos = await positions(b, department, heads);
  const byHead = new Map(pos.map((p) => [p.head, p]));
  const change = new Map<string, number>();
  for (const l of lines) {
    change.set(l.fromHead, (change.get(l.fromHead) ?? 0) - l.amount);
    change.set(l.toHead, (change.get(l.toHead) ?? 0) + l.amount);
  }
  const total = sum(lines.map((l) => l.amount));
  const label = (h: string) => headOf(h)?.label ?? h;
  return {
    budget: { id: b.id, budgetCode: b.budgetCode, status: b.status, statusLabel: statusLabel(b.status) },
    position: pos,
    lines: lines.map((l, i) => ({
      position: i,
      ...l,
      fromHeadLabel: label(l.fromHead),
      fromSubHeadLabel: subHeadOf(l.fromHead, l.fromSubHead)?.label ?? null,
      toHeadLabel: label(l.toHead),
      toSubHeadLabel: subHeadOf(l.toHead, l.toSubHead)?.label ?? null,
      fromAvailable: byHead.get(l.fromHead)?.available ?? 0,
      toAvailable: byHead.get(l.toHead)?.available ?? 0,
    })),
    summary: {
      totalTransferAmount: total,
      fromHeads: [...new Set(lines.map((l) => label(l.fromHead)))].join(', '),
      toHeads: [...new Set(lines.map((l) => label(l.toHead)))].join(', '),
      netImpactOnDepartment: 0,
      netImpactLabel: 'No Change (৳ 0)',
    },
    afterTransfer: heads.map((h) => {
      const current = byHead.get(h)?.budget ?? 0;
      const t = round2(change.get(h) ?? 0);
      return {
        head: h,
        headLabel: label(h),
        currentBudget: current,
        transfer: t,
        revisedBudget: round2(current + t),
      };
    }),
  };
}

async function nextCode(financialYear: string) {
  const s = await budgetSettings();
  const n = s.numbering.find((x) => x.docType === 'TRANSFER') ?? {
    docType: 'TRANSFER',
    prefix: 'TRF',
    digits: 4,
  };
  const year = Number(financialYear.slice(0, 4));
  const start = `${n.prefix}-${year}-`;
  const rows = await db.budgetTransfer.findMany({
    where: { code: { startsWith: start } },
    select: { code: true },
  });
  return codeOf(
    n,
    year,
    rows.reduce((top, r) => Math.max(top, Number(r.code.slice(start.length)) || 0), 0) + 1,
  );
}

export const budgetTransfersRouter = defineResource('/budget-transfers', {
  name: 'budgetTransfer',
  label: 'Budget transfer',
  module: 'budget',
  page: 'Budget Transfer',
  describe: (r) => show(r.code, paren(r.title)),
  model: 'budgetTransfer',
  schema,
  search: ['code', 'title'],
  filters: ['estate', 'financialYear', 'budget', 'department', 'status'],
  refs: { estate: { model: 'estate', label: 'estateName' } },
  files: ['attachments'],
  children: [
    {
      key: 'lines',
      model: 'budgetTransferLine',
      parentKey: 'transferId',
      schema: lineSchema,
      decorate: (rows) =>
        rows.map((r) => ({
          ...r,
          fromHeadLabel: headOf(r.fromHead)?.label ?? null,
          fromSubHeadLabel: subHeadOf(r.fromHead, r.fromSubHead)?.label ?? null,
          toHeadLabel: headOf(r.toHead)?.label ?? null,
          toSubHeadLabel: subHeadOf(r.toHead, r.toSubHead)?.label ?? null,
        })),
    },
  ],
  orderBy: [{ transferDate: 'desc' }, { code: 'desc' }, { id: 'asc' }],
  skipApproval: () => true,
  check: async (values, id, rows) => {
    const fields: Record<string, string> = {};
    if (id) {
      const before = await db.budgetTransfer.findFirst({
        where: { id, deletedAt: null },
        select: { status: true },
      });
      if (before && !EDITABLE.includes(before.status))
        fields.status = `This transfer is ${statusLabel(before.status)}: only a Draft or Returned one can be edited.`;
    }
    if (isoDate(values.transferDate) > todayDhaka())
      fields.transferDate = 'The date cannot be in the future.';
    if (typeof values.justification !== 'string' || !values.justification.trim())
      fields.justification = 'This field is required.';
    const b = await approvedBudgetOf(String(values.estate), String(values.financialYear));
    if (!b)
      fields.financialYear = `There is no Approved budget for this estate in ${fyLabel(String(values.financialYear))}.`;
    else if (!b.lines.some((l) => l.department === values.department))
      fields.department = `${labelIn(BUDGET_DEPARTMENTS, values.department)} has no budget in ${b.budgetCode}.`;
    Object.assign(fields, await attachmentProblems(values.attachments));
    if (b && !fields.department)
      Object.assign(fields, await lineProblems(b, String(values.department), asLines(rows?.lines)));
    return fields;
  },
  onSave: async (values) => {
    const b = await approvedBudgetOf(String(values.estate), String(values.financialYear));
    return b ? { budget: b.id } : {};
  },
  onCreate: async (values) => ({ code: await nextCode(String(values.financialYear)), status: 'DRAFT' }),
  extend: (row) => ({
    transferDate: isoDate(row.transferDate),
    financialYearLabel: fyLabel(String(row.financialYear)),
    departmentLabel: labelIn(BUDGET_DEPARTMENTS, row.department),
    transferTypeLabel: labelIn(TYPES, row.transferType),
    statusLabel: statusLabel(row.status),
    preparedBy: row.createdBy,
    editable: EDITABLE.includes(String(row.status)),
  }),
  enrich: async (rows) => {
    const lines = await db.budgetTransferLine.findMany({
      where: { transferId: { in: rows.map((r) => String(r.id)) } },
      select: { transferId: true, amount: true, fromHead: true, toHead: true },
    });
    const budgets = new Map(
      (
        await db.budget.findMany({
          where: { id: { in: [...new Set(rows.map((r) => String(r.budget)))] } },
          select: { id: true, budgetCode: true },
        })
      ).map((b) => [b.id, b.budgetCode]),
    );
    return new Map(
      rows.map((r) => {
        const mine = lines.filter((l) => l.transferId === r.id);
        return [
          String(r.id),
          {
            budgetCode: budgets.get(String(r.budget)) ?? null,
            totalTransferAmount: sum(mine.map((l) => Number(l.amount))),
            totalLines: mine.length,
            fromHeads: [...new Set(mine.map((l) => headOf(l.fromHead)?.label))].join(', '),
            toHeads: [...new Set(mine.map((l) => headOf(l.toHead)?.label))].join(', '),
          },
        ];
      }),
    );
  },
  deleteCheck: (row) =>
    Promise.resolve(
      EDITABLE.includes(String(row.status)) || row.status === 'REJECTED'
        ? undefined
        : `This transfer is ${statusLabel(row.status)}: only a Draft, Returned or Rejected one can be deleted.`,
    ),
  export: {
    fileName: 'budget-transfers',
    sheet: 'Budget Transfers',
    columns: [
      { header: 'SL', value: (_r, i) => i + 1, width: 6 },
      { header: 'Transfer Code', value: (r) => r.code, width: 18 },
      { header: 'Date', value: (r) => r.transferDate, width: 12 },
      { header: 'Financial Year', value: (r) => r.financialYearLabel, width: 14 },
      { header: 'Estate', value: (r) => r.estateName, width: 22 },
      { header: 'Department', value: (r) => r.departmentLabel, width: 28 },
      { header: 'Title', value: (r) => r.title, width: 32 },
      { header: 'From', value: (r) => r.fromHeads, width: 24 },
      { header: 'To', value: (r) => r.toHeads, width: 24 },
      { header: 'Amount (৳)', value: (r) => r.totalTransferAmount, width: 16, numFmt: '#,##0' },
      { header: 'Status', value: (r) => r.statusLabel, width: 12 },
    ],
  },
  options: {
    path: 'budget-transfers',
    label: (row) => `${String(row.code)} — ${String(row.title)}`,
    filters: ['budget', 'status'],
  },
});

async function savedLines(id: string) {
  return asLines(
    await db.budgetTransferLine.findMany({ where: { transferId: id }, orderBy: { position: 'asc' } }),
  );
}

async function applyTransfer(tx: Tx, row: Record<string, unknown>, userId: string) {
  const b = await approvedBudgetOf(String(row.estate), String(row.financialYear));
  if (!b || b.id !== row.budget)
    throw new AppError('DUPLICATE', 'The annual budget is no longer Approved; reject this transfer.');
  const department = String(row.department);
  const lines = await savedLines(String(row.id));
  const problems = await lineProblems(b, department, lines);
  if (Object.keys(problems).length)
    throw new AppError(
      'DUPLICATE',
      `This transfer no longer fits the budget: ${Object.values(problems)[0]} Return it to the preparer.`,
      problems,
    );
  const change = new Map<string, number>();
  for (const l of lines) {
    change.set(l.fromHead, (change.get(l.fromHead) ?? 0) - l.amount);
    change.set(l.toHead, (change.get(l.toHead) ?? 0) + l.amount);
  }
  const before = b.lines
    .filter((l) => l.department === department && change.has(l.head))
    .map((l) => ({ id: l.id, head: l.head, annualAmount: Number(l.annualAmount) }));
  let position = nextPosition(b.lines);
  for (const [head, delta] of change)
    position = await changeHead(
      tx,
      b,
      department,
      head,
      round2(delta),
      headOf(head)?.category ?? 'OPEX',
      position,
    );
  await tx.budget.update({ where: { id: b.id }, data: { updatedAt: new Date(), updatedBy: userId } });
  await writeHistory(tx, {
    resource: 'budget',
    recordId: b.id,
    action: 'update',
    oldData: { department, lines: before },
    newData: {
      transfer: String(row.code),
      changes: [...change].map(([head, delta]) => ({ head, change: round2(delta) })),
    },
    userId,
    approvalId: null,
  });
}

registerWorkflowDoc({
  docType: 'TRANSFER',
  label: 'Budget transfer',
  resource: 'budgetTransfer',
  find: (id) => db.budgetTransfer.findFirst({ where: { id } }),
  update: async (tx, id, from, data) =>
    (
      await tx.budgetTransfer.updateMany({
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
    const b = await approvedBudgetOf(String(row.estate), String(row.financialYear));
    if (!b || b.id !== row.budget) return 'The annual budget is no longer Approved.';
    const first = Object.values(
      await lineProblems(b, String(row.department), await savedLines(String(row.id))),
    )[0];
    return first ? `Check the lines first: ${first}` : undefined;
  },
  onApproved: applyTransfer,
});

export const budgetTransferExtrasRouter = Router();

budgetTransferExtrasRouter.get('/filter-options', (_req, res) => {
  res.json({
    transferTypes: numbered(TYPES),
    departments: numbered(BUDGET_DEPARTMENTS),
    statuses: numbered(STATUSES),
    attachmentTypes: ['PDF', 'XLSX', 'JPG', 'PNG'],
  });
});

budgetTransferExtrasRouter.get('/next-code', async (req, res) => {
  const fy =
    typeof req.query.financialYear === 'string' && /^\d{4}-\d{4}$/.test(req.query.financialYear)
      ? req.query.financialYear
      : (await budgetSettings()).defaultFinancialYear;
  res.json({ code: await nextCode(fy) });
});

/** From / To side boxes: `?estate=&financialYear=&department=&head=` (one head) or all heads of the department. */
budgetTransferExtrasRouter.get('/position', async (req, res) => {
  const q = (k: string) => (typeof req.query[k] === 'string' ? req.query[k].trim() : '');
  const b = await approvedBudgetOf(q('estate'), q('financialYear'));
  if (!b)
    throw new AppError('VALIDATION', VALIDATION, {
      financialYear: 'There is no Approved budget for this estate and year.',
    });
  const department = q('department');
  if (!valuesOf(BUDGET_DEPARTMENTS).includes(department))
    throw new AppError('VALIDATION', VALIDATION, { department: 'Select a value from the list.' });
  const heads = q('head')
    ? [q('head')]
    : [...new Set(b.lines.filter((l) => l.department === department).map((l) => l.head))];
  res.json({
    budget: { id: b.id, budgetCode: b.budgetCode },
    department,
    departmentLabel: labelIn(BUDGET_DEPARTMENTS, department),
    heads: await positions(b, department, heads),
  });
});

const previewSchema = z.object({
  estate: z.string(),
  financialYear: z.string(),
  department: oneOf(valuesOf(BUDGET_DEPARTMENTS)),
  lines: z.array(lineSchema).max(100),
});

/** Budget Position, lines, Transfer Summary, Budget After Transfer and `problems`, before saving. */
budgetTransferExtrasRouter.post('/preview', async (req, res) => {
  const p = previewSchema.safeParse(req.body ?? {});
  if (!p.success) {
    const fields: Record<string, string> = {};
    for (const i of p.error.issues) fields[i.path.join('.')] ??= i.message;
    throw new AppError('VALIDATION', VALIDATION, fields);
  }
  const b = await approvedBudgetOf(p.data.estate, p.data.financialYear);
  if (!b)
    throw new AppError('VALIDATION', VALIDATION, {
      financialYear: 'There is no Approved budget for this estate and year.',
    });
  res.json({
    ...(await figures(b, p.data.department, p.data.lines)),
    problems: await lineProblems(b, p.data.department, p.data.lines),
  });
});

budgetTransferExtrasRouter.get('/:id/impact', async (req, res) => {
  const row = await db.budgetTransfer.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!row) throw notFound('Budget transfer');
  const b = await db.budget.findFirst({
    where: { id: row.budget },
    include: { lines: { orderBy: { position: 'asc' } } },
  });
  if (!b) throw notFound('Budget');
  const f = await figures(b, row.department, await savedLines(row.id));
  // After approval the budget already holds the move: show the amounts before it.
  if (row.status === 'APPROVED')
    for (const a of f.afterTransfer) {
      a.revisedBudget = a.currentBudget;
      a.currentBudget = round2(a.currentBudget - a.transfer);
    }
  res.json(f);
});

budgetTransferExtrasRouter.get('/:id/workflow', async (req, res) => {
  const row = await db.budgetTransfer.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!row) throw notFound('Budget transfer');
  res.json(await workflowView('TRANSFER', row));
});

const doc = (summary: string, method: 'get' | 'post' = 'get') => ({
  [method]: { tags: ['Budget'], summary, responses: { '200': { description: 'ok' } } },
});
docsPaths['/budget-transfers/filter-options'] = doc('Budget Transfer lists');
docsPaths['/budget-transfers/next-code'] = doc('Next TRF code for ?financialYear=');
docsPaths['/budget-transfers/position'] = doc(
  'Budget, actual, committed and available of heads: ?estate=&financialYear=&department=&head=',
);
docsPaths['/budget-transfers/preview'] = doc(
  'Position, summary and after-transfer figures before saving',
  'post',
);
docsPaths['/budget-transfers/{id}/impact'] = doc('Figures of a saved transfer');
docsPaths['/budget-transfers/{id}/workflow'] = doc('Approval Workflow card of a transfer');
