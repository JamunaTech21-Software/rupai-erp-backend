import { join } from 'node:path';

import ExcelJS from 'exceljs';
import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { list, longText, num, oneOf, ref, reqDate, text } from '../../lib/fields.js';
import { writeHistory } from '../../lib/history.js';
import { newId } from '../../lib/ids.js';
import { currentUserId, defineResource } from '../../lib/resource.js';
import { toJson } from '../../lib/serialize.js';
import { z } from '../../lib/validation.js';
import { uploadRoot } from '../files/service.js';
import { todayDhaka } from '../weather/entries.js';
import {
  BUDGET_DEPARTMENTS,
  BUDGET_HEADS,
  CATEGORY_LABELS,
  OTHER_COST_CENTERS,
  headOf,
  labelIn,
} from './heads.js';
import { ALLOCATION_METHODS, budgetSettings, codeOf, fyLabel } from './settings.js';
import { EDITABLE, STATUSES, registerWorkflowDoc, statusLabel, workflowView } from './workflow.js';

/**
 * RP1-243 B.3 Annual Budget Planning (`/budget-planning`, `images/2.jpeg`): `/budgets` with its budget head lines.
 * One annual budget per estate and financial year. The form saves a Draft (never through the approval queue: the
 * budget workflow of `workflow.ts` takes over at Submit for Approval). Draft and Returned budgets can be edited
 * and deleted; Pending, Approved and Rejected cannot (an approved budget changes only by Revision / Transfer).
 * Each line's 12 monthly % must add up to 100; amounts are worked out in whole taka (December takes the
 * remainder). The sums per department are the department limits of B.4 / B.5.
 */
export const BUDGET_CATEGORIES = [
  { value: 'OPEX', label: 'OPEX (Operational)' },
  { value: 'CAPEX', label: 'CAPEX (Capital)' },
  { value: 'BOTH', label: 'Both (OPEX & CAPEX)' },
];
const BUDGET_TYPES = [{ value: 'ANNUAL', label: 'Annual' }];
const ATTACHMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_MB = 10;
const VALIDATION = 'Please correct the highlighted fields.';
const valuesOf = (l: { value: string }[]) => l.map((o) => o.value);
const COST_CENTER_OTHERS = valuesOf(OTHER_COST_CENTERS);
export const round2 = (v: number) => Math.round(v * 100) / 100;

/** 12 amounts from the %: whole taka, December takes what rounding left. */
export function monthAmounts(amount: number, percents: number[]) {
  const out = percents.slice(0, 11).map((p) => Math.round((amount * p) / 100));
  out.push(round2(amount - out.reduce((s, v) => s + v, 0)));
  return out;
}
/** The 12 % of Equal or Seasonal allocation (Manual: the ones given, else Equal). */
export function methodPercents(method: string, seasonal: number[]) {
  if (method === 'SEASONAL') return [...seasonal];
  const each = Math.floor((100 / 12) * 100) / 100;
  return [...Array<number>(11).fill(each), round2(100 - each * 11)];
}

const lineSchema = z.object({
  head: oneOf(valuesOf(BUDGET_HEADS)),
  department: oneOf(valuesOf(BUDGET_DEPARTMENTS)),
  costCenter: text(26),
  annualAmount: num('Must be more than 0.')
    .refine((v) => v > 0, 'Must be more than 0.')
    .refine((v) => v < 1e13, 'Too large.'),
  allocationMethod: oneOf(valuesOf(ALLOCATION_METHODS)),
  monthPercents: z
    .array(
      num('Must be 0 or more.').refine((v) => v <= 100, 'Use 0 to 100.'),
      { error: 'Send the 12 monthly %.' },
    )
    .length(12, 'Send the 12 monthly %.'),
});

const budgetSchema = z.object({
  budgetName: text(150),
  financialYear: text(9).regex(/^\d{4}-\d{4}$/, 'Select a financial year from the list.'),
  estate: ref(),
  budgetType: oneOf(valuesOf(BUDGET_TYPES)),
  category: oneOf(valuesOf(BUDGET_CATEGORIES)),
  preparationDate: reqDate(),
  remarks: longText(),
  attachments: list(),
});

/** Attachments: PDF, XLSX, JPG, PNG; at most 10 files of 10 MB. */
export async function attachmentProblems(value: unknown): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};
  const files = (value ?? []) as string[];
  if (files.length > MAX_ATTACHMENTS) fields.attachments = `At most ${MAX_ATTACHMENTS} files.`;
  else if (files.length) {
    const stored = await db.storedFile.findMany({
      where: { id: { in: files } },
      select: { type: true, size: true },
    });
    if (stored.some((f) => !ATTACHMENT_TYPES.includes(f.type)))
      fields.attachments = 'Use PDF, Excel (.xlsx), JPG or PNG files.';
    else if (stored.some((f) => f.size > MAX_ATTACHMENT_MB * 1024 * 1024))
      fields.attachments = `Each file must be ${MAX_ATTACHMENT_MB} MB or smaller.`;
  }
  return fields;
}

/** Labels of a budget's lines; cost centers that are divisions get the division name. */
export async function labelLines(rows: Record<string, unknown>[]) {
  const ids = [
    ...new Set(
      rows
        .map((r) => r.costCenter)
        .filter((v): v is string => typeof v === 'string' && !COST_CENTER_OTHERS.includes(v)),
    ),
  ];
  const divisions = new Map(
    ids.length
      ? (
          await db.division.findMany({ where: { id: { in: ids } }, select: { id: true, divisionName: true } })
        ).map((d) => [d.id, d.divisionName])
      : [],
  );
  return rows.map((r) => ({
    ...r,
    headLabel: headOf(r.head)?.label ?? null,
    categoryLabel: CATEGORY_LABELS[String(r.category)] ?? null,
    departmentLabel: labelIn(BUDGET_DEPARTMENTS, r.department),
    costCenterLabel:
      labelIn(OTHER_COST_CENTERS, r.costCenter) ??
      (typeof r.costCenter === 'string' ? (divisions.get(r.costCenter) ?? null) : null),
    allocationMethodLabel: labelIn(ALLOCATION_METHODS, r.allocationMethod),
  }));
}

/** The next code for a financial year (deleted budgets count too, so a code is never given twice). */
async function nextBudgetCode(financialYear: string) {
  const settings = await budgetSettings();
  const numbering = settings.numbering.find((n) => n.docType === 'ANNUAL_BUDGET') ?? {
    docType: 'ANNUAL_BUDGET',
    prefix: 'BUD',
    digits: 4,
  };
  const year = Number(financialYear.slice(0, 4)) || Number(todayDhaka().slice(0, 4));
  const start = `${numbering.prefix}-${year}-`;
  const rows = await db.budget.findMany({
    where: { budgetCode: { startsWith: start } },
    select: { budgetCode: true },
  });
  const max = rows.reduce((top, r) => Math.max(top, Number(r.budgetCode.slice(start.length)) || 0), 0);
  return codeOf(numbering, year, max + 1);
}

/** Problems of the lines against the budget (category, cost center, %), by `lines.<i>.<field>`. */
async function lineProblems(values: Record<string, unknown>, lines: Record<string, unknown>[]) {
  const fields: Record<string, string> = {};
  const estate = typeof values.estate === 'string' ? values.estate : '';
  const divisionIds = new Set(
    (await db.division.findMany({ where: { estate, deletedAt: null }, select: { id: true } })).map(
      (d) => d.id,
    ),
  );
  lines.forEach((l, i) => {
    const head = headOf(l.head);
    if (head && values.category !== 'BOTH' && head.category !== values.category)
      fields[`lines.${i}.head`] =
        `${head.label} is ${head.category}; this budget is ${String(values.category)} only.`;
    if (
      typeof l.costCenter === 'string' &&
      !COST_CENTER_OTHERS.includes(l.costCenter) &&
      !divisionIds.has(l.costCenter)
    )
      fields[`lines.${i}.costCenter`] =
        'Select a division of this estate or another cost center from the list.';
    const sum = ((l.monthPercents ?? []) as number[]).reduce((s, p) => s + p, 0);
    if (Math.abs(sum - 100) > 0.01)
      fields[`lines.${i}.monthPercents`] = `The 12 monthly % must add up to 100 (now ${round2(sum)}).`;
  });
  return fields;
}

export const budgetsRouter = defineResource('/budgets', {
  name: 'budget',
  label: 'Budget',
  module: 'budget',
  page: 'Annual Budget Planning',
  describe: (r) => show(r.budgetCode, paren(r.budgetName)),
  model: 'budget',
  schema: budgetSchema,
  search: ['budgetCode', 'budgetName'],
  searchAlso: (term) => [{ estateRef: { estateName: { contains: term } } }],
  filters: ['estate', 'financialYear', 'status', 'category', 'budgetType'],
  refs: { estate: { model: 'estate', label: 'estateName' } },
  files: ['attachments'],
  children: [
    {
      key: 'lines',
      model: 'budgetLine',
      parentKey: 'budgetId',
      schema: lineSchema,
      compute: (row) => ({
        ...row,
        category: headOf(row.head)?.category ?? 'OPEX',
        monthAmounts: monthAmounts(Number(row.annualAmount), row.monthPercents as number[]),
      }),
      decorate: (rows) => labelLines(rows),
    },
  ],
  orderBy: [{ financialYear: 'desc' }, { budgetCode: 'desc' }, { id: 'asc' }],
  // The form only saves drafts; approval is the budget workflow (decision 2026-11-26).
  skipApproval: () => true,
  check: async (values, id, rows) => {
    const fields: Record<string, string> = {};
    if (id) {
      const before = await db.budget.findFirst({ where: { id, deletedAt: null }, select: { status: true } });
      if (before && !EDITABLE.includes(before.status))
        fields.status = `This budget is ${statusLabel(before.status)}: only a Draft or Returned budget can be edited.`;
    }
    const fy = String(values.financialYear);
    if (Number(fy.slice(5)) !== Number(fy.slice(0, 4)) + 1)
      fields.financialYear = 'Select a financial year from the list.';
    else {
      const other = await db.budget.findFirst({
        where: {
          estate: String(values.estate),
          financialYear: fy,
          deletedAt: null,
          ...(id ? { NOT: { id } } : {}),
        },
        select: { budgetCode: true },
      });
      if (other)
        fields.financialYear = `This estate already has a budget for ${fyLabel(fy)} (${other.budgetCode}).`;
    }
    Object.assign(fields, await attachmentProblems(values.attachments));
    Object.assign(fields, await lineProblems(values, (rows?.lines ?? []) as Record<string, unknown>[]));
    return fields;
  },
  onCreate: async (values) => ({
    budgetCode: await nextBudgetCode(String(values.financialYear)),
    status: 'DRAFT',
  }),
  extend: (row) => ({
    financialYearLabel: fyLabel(String(row.financialYear)),
    budgetTypeLabel: labelIn(BUDGET_TYPES, row.budgetType),
    categoryLabel: labelIn(BUDGET_CATEGORIES, row.category),
    statusLabel: statusLabel(row.status),
    preparedBy: row.createdBy,
    editable: EDITABLE.includes(String(row.status)),
  }),
  // Budget Summary: totals from the lines.
  enrich: async (rows) => {
    const lines = await db.budgetLine.findMany({
      where: { budgetId: { in: rows.map((r) => String(r.id)) } },
      select: { budgetId: true, category: true, department: true, annualAmount: true, monthAmounts: true },
    });
    const out = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const mine = lines.filter((l) => l.budgetId === r.id);
      const total = (cat?: string) =>
        round2(
          mine.filter((l) => !cat || l.category === cat).reduce((s, l) => s + Number(l.annualAmount), 0),
        );
      const months = Array.from({ length: 12 }, (_, i) =>
        round2(mine.reduce((s, l) => s + Number((l.monthAmounts as number[])[i] ?? 0), 0)),
      );
      out.set(String(r.id), {
        totalBudget: total(),
        opexBudget: total('OPEX'),
        capexBudget: total('CAPEX'),
        totalBudgetHeads: mine.length,
        departments: new Set(mine.map((l) => l.department)).size,
        monthlyAllocationMonths: 12,
        monthTotals: months,
      });
    }
    return out;
  },
  deleteCheck: (row) =>
    Promise.resolve(
      EDITABLE.includes(String(row.status)) || row.status === 'REJECTED'
        ? undefined
        : `This budget is ${statusLabel(row.status)}: only a Draft, Returned or Rejected budget can be deleted.`,
    ),
  export: {
    fileName: 'annual-budgets',
    sheet: 'Annual Budgets',
    columns: [
      { header: 'SL', value: (_r, i) => i + 1, width: 6 },
      { header: 'Budget Code', value: (r) => r.budgetCode, width: 16 },
      { header: 'Budget Name', value: (r) => r.budgetName, width: 34 },
      { header: 'Financial Year', value: (r) => r.financialYearLabel, width: 14 },
      { header: 'Estate', value: (r) => r.estateName, width: 24 },
      { header: 'Category', value: (r) => r.categoryLabel, width: 20 },
      { header: 'Total Budget (৳)', value: (r) => r.totalBudget, width: 18, numFmt: '#,##0' },
      { header: 'OPEX (৳)', value: (r) => r.opexBudget, width: 16, numFmt: '#,##0' },
      { header: 'CAPEX (৳)', value: (r) => r.capexBudget, width: 16, numFmt: '#,##0' },
      { header: 'Status', value: (r) => r.statusLabel, width: 12 },
    ],
  },
  options: {
    path: 'budgets',
    label: (row) => `${String(row.budgetCode)} — ${String(row.budgetName)}`,
    filters: ['estate', 'financialYear', 'status'],
  },
});

registerWorkflowDoc({
  docType: 'ANNUAL_BUDGET',
  label: 'Annual budget',
  resource: 'budget',
  find: (id) => db.budget.findFirst({ where: { id } }),
  update: async (tx, id, from, data) =>
    (
      await tx.budget.updateMany({
        where: { id, deletedAt: null, status: from.status, currentStep: from.currentStep },
        data: {
          ...data,
          workflowLevels: data.workflowLevels === undefined ? undefined : (data.workflowLevels as object),
          // Always a change, so a step that keeps the status (Request Info) still counts as one row.
          updatedAt: new Date(),
        },
      })
    ).count,
  code: (row) => String(row.budgetCode),
  canSubmit: async (row) => {
    const lines = await db.budgetLine.findMany({
      where: { budgetId: String(row.id) },
      select: { annualAmount: true },
    });
    if (!lines.length) return 'Add at least one budget head before submitting.';
    return undefined;
  },
});

// ---- Extras: filter options, next code, allocation preview, workflow card, Excel template and import ---------

export const budgetExtrasRouter = Router();
const numbered = <T extends object>(l: T[]) => l.map((o, i) => ({ id: i + 1, ...o }));

budgetExtrasRouter.get('/filter-options', async (_req, res) => {
  const s = await budgetSettings();
  const current = Number(s.defaultFinancialYear.slice(0, 4));
  res.json({
    financialYears: numbered(
      [-2, -1, 0, 1, 2]
        .map((d) => `${current + d}-${current + d + 1}`)
        .map((fy) => ({ value: fy, label: fyLabel(fy) })),
    ),
    defaultFinancialYear: s.defaultFinancialYear,
    budgetTypes: numbered(BUDGET_TYPES),
    categories: numbered(BUDGET_CATEGORIES),
    statuses: numbered(STATUSES),
    allocationMethods: numbered(ALLOCATION_METHODS),
    defaultAllocationMethod: s.allocationMethod,
    seasonalPercents: s.seasonalPercents,
    attachmentTypes: ['PDF', 'XLSX', 'JPG', 'PNG'],
    maxAttachments: MAX_ATTACHMENTS,
    maxAttachmentMb: MAX_ATTACHMENT_MB,
  });
});

budgetExtrasRouter.get('/next-code', async (req, res) => {
  const fy =
    typeof req.query.financialYear === 'string' && /^\d{4}-\d{4}$/.test(req.query.financialYear)
      ? req.query.financialYear
      : (await budgetSettings()).defaultFinancialYear;
  res.json({ budgetCode: await nextBudgetCode(fy) });
});

/** The Monthly Allocation panel: % and amounts of a method for an amount (Seasonal % from Budget Settings). */
budgetExtrasRouter.get('/allocation-preview', async (req, res) => {
  const method = typeof req.query.method === 'string' ? req.query.method.toUpperCase() : 'EQUAL';
  const amount = Number(req.query.amount);
  const fields: Record<string, string> = {};
  if (!valuesOf(ALLOCATION_METHODS).includes(method)) fields.method = 'Select a value from the list.';
  if (!(amount > 0)) fields.amount = 'Must be more than 0.';
  if (Object.keys(fields).length) throw new AppError('VALIDATION', VALIDATION, fields);
  const percents = methodPercents(method, (await budgetSettings()).seasonalPercents);
  const amounts = monthAmounts(amount, percents);
  res.json({
    method,
    amount,
    months: percents.map((p, i) => ({ month: i + 1, percent: p, amount: amounts[i] })),
    totalPercent: round2(percents.reduce((s, p) => s + p, 0)),
    totalAmount: round2(amounts.reduce((s, a) => s + a, 0)),
  });
});

budgetExtrasRouter.get('/:id/workflow', async (req, res) => {
  const row = await db.budget.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!row) throw notFound('Budget');
  res.json(await workflowView('ANNUAL_BUDGET', row));
});

export const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const TEMPLATE_HEADERS = [
  'Budget Head',
  'Department',
  'Division / Cost Center',
  'Annual Amount (৳)',
  'Allocation Method',
  ...MONTH_SHORT.map((m) => `${m} %`),
];

budgetExtrasRouter.get('/import-template', async (_req, res) => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Budget Heads');
  sheet.addRow(TEMPLATE_HEADERS);
  sheet.getRow(1).font = { bold: true };
  sheet.addRow(['Labour & Wages', 'HR & Labour', 'All Divisions', 50000000, 'Equal Allocation']);
  sheet.addRow([
    'Fertilizer',
    'Agriculture (Field Operations)',
    'All Divisions',
    12000000,
    'Seasonal Allocation',
  ]);
  sheet.addRow([
    'IT Equipment',
    'Administration',
    'Estate Office',
    5000000,
    'Manual Allocation',
    10,
    10,
    10,
    10,
    10,
    10,
    5,
    5,
    5,
    5,
    10,
    10,
  ]);
  sheet.columns.forEach((c, i) => (c.width = i < 5 ? 28 : 8));
  const lists = book.addWorksheet('Lists');
  lists.addRow(['Budget Head', 'Category', 'Department', 'Division / Cost Center', 'Allocation Method']);
  lists.getRow(1).font = { bold: true };
  const n = Math.max(BUDGET_HEADS.length, BUDGET_DEPARTMENTS.length);
  for (let i = 0; i < n; i++)
    lists.addRow([
      BUDGET_HEADS[i]?.label ?? '',
      BUDGET_HEADS[i]?.category ?? '',
      BUDGET_DEPARTMENTS[i]?.label ?? '',
      i === 0 ? 'All Divisions, a division name, Estate Office or Factory' : '',
      ALLOCATION_METHODS[i]?.label ?? '',
    ]);
  lists.columns.forEach((c) => (c.width = 30));
  res.setHeader('Content-Disposition', 'attachment; filename="budget-heads-template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(Buffer.from(await book.xlsx.writeBuffer()));
});

export const norm = (v: unknown) =>
  (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
export const cellValue = (v: ExcelJS.CellValue): unknown =>
  v && typeof v === 'object' && 'result' in v
    ? v.result
    : v && typeof v === 'object' && 'richText' in v
      ? v.richText.map((t) => t.text).join('')
      : v;

/**
 * Import (Excel): `{ file: <uploaded .xlsx id>, replace?: true }` adds the sheet's rows as budget heads (or
 * replaces them). Names match the lists (any case); left-out Allocation Method = the Settings default; Equal /
 * Seasonal fill the %; Manual needs the 12 %. Any wrong row refuses the whole file (`rows.<n>.<field>`, n = the
 * Excel row number).
 */
budgetExtrasRouter.post('/:id/import', async (req, res) => {
  const budget = await db.budget.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!budget) throw notFound('Budget');
  if (!EDITABLE.includes(budget.status))
    throw new AppError(
      'DUPLICATE',
      `This budget is ${statusLabel(budget.status)}: only a Draft or Returned budget can be changed.`,
    );
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
  const settings = await budgetSettings();
  const divisions = await db.division.findMany({
    where: { estate: budget.estate, deletedAt: null },
    select: { id: true, divisionName: true },
  });
  const fields: Record<string, string> = {};
  const parsed: Record<string, unknown>[] = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const v = (i: number) => cellValue(row.getCell(i).value);
    if ([1, 2, 3, 4].every((i) => norm(v(i)) === '')) return;
    const at = (k: string, m: string) => (fields[`rows.${n}.${k}`] ??= m);
    const head = BUDGET_HEADS.find((h) => norm(h.label) === norm(v(1)) || norm(h.value) === norm(v(1)));
    if (!head) at('head', 'Unknown budget head.');
    const department = BUDGET_DEPARTMENTS.find((d) =>
      [norm(d.label), norm(d.value), norm(d.label.replace(/ \(.*\)$/, ''))].includes(norm(v(2))),
    );
    if (!department) at('department', 'Unknown department.');
    const ccText = norm(v(3)) || 'all divisions';
    const costCenter =
      OTHER_COST_CENTERS.find((o) => norm(o.label) === ccText)?.value ??
      divisions.find((d) => norm(d.divisionName) === ccText)?.id;
    if (!costCenter)
      at('costCenter', 'Use All Divisions, a division of this estate, Estate Office or Factory.');
    const amount = Number(v(4));
    if (!(amount > 0) || amount >= 1e13) at('annualAmount', 'Must be more than 0.');
    const methodText = norm(v(5));
    const method = methodText
      ? ALLOCATION_METHODS.find(
          (m) =>
            norm(m.label) === methodText ||
            norm(m.value) === methodText ||
            norm(m.label).startsWith(methodText),
        )?.value
      : settings.allocationMethod;
    if (!method) at('allocationMethod', 'Use Equal, Seasonal or Manual Allocation.');
    let percents = methodPercents(method ?? 'EQUAL', settings.seasonalPercents);
    if (method === 'MANUAL') {
      percents = MONTH_SHORT.map((_, i) => Number(v(6 + i)));
      if (percents.some((p) => !Number.isFinite(p) || p < 0 || p > 100))
        at('monthPercents', 'Manual Allocation needs the 12 monthly % (0 to 100).');
      else if (Math.abs(percents.reduce((s, p) => s + p, 0) - 100) > 0.01)
        at('monthPercents', 'The 12 monthly % must add up to 100.');
    }
    if (head && budget.category !== 'BOTH' && head.category !== budget.category)
      at('head', `${head.label} is ${head.category}; this budget is ${budget.category} only.`);
    if (head && department && costCenter && method && amount > 0)
      parsed.push({
        head: head.value,
        category: head.category,
        department: department.value,
        costCenter,
        annualAmount: amount,
        allocationMethod: method,
        monthPercents: percents,
        monthAmounts: monthAmounts(amount, percents),
      });
  });
  if (Object.keys(fields).length)
    throw new AppError('VALIDATION', 'Some rows of the file are wrong; nothing was imported.', fields);
  if (!parsed.length) throw new AppError('VALIDATION', VALIDATION, { file: 'The file has no budget heads.' });
  const replace = body.replace === true || body.replace === 'true';
  const userId = currentUserId(req);
  const before = await db.budgetLine.findMany({
    where: { budgetId: budget.id },
    orderBy: { position: 'asc' },
  });
  await db.$transaction(async (tx) => {
    if (replace) await tx.budgetLine.deleteMany({ where: { budgetId: budget.id } });
    const start = replace ? 0 : before.length;
    await tx.budgetLine.createMany({
      data: parsed.map((l, i) => ({
        ...(l as object),
        id: newId(),
        budgetId: budget.id,
        position: start + i,
      })) as never,
    });
    await tx.budget.update({ where: { id: budget.id }, data: { updatedBy: userId } });
    await writeHistory(tx, {
      resource: 'budget',
      recordId: budget.id,
      action: 'update',
      oldData: { lines: before.length },
      newData: { imported: parsed.length, replace, file: file.name },
      userId,
      approvalId: null,
    });
  });
  res.json(
    toJson({
      imported: parsed.length,
      replaced: replace,
      totalLines: (replace ? 0 : before.length) + parsed.length,
    }),
  );
});

docsPaths['/budgets/filter-options'] = {
  get: {
    tags: ['Budget'],
    summary:
      'Annual Budget Planning lists: financial years, types, categories, statuses, allocation methods, seasonal %',
    responses: { '200': { description: 'lists' } },
  },
};
docsPaths['/budgets/next-code'] = {
  get: {
    tags: ['Budget'],
    summary: 'The next Budget Code for ?financialYear=',
    responses: { '200': { description: '{ budgetCode }' } },
  },
};
docsPaths['/budgets/allocation-preview'] = {
  get: {
    tags: ['Budget'],
    summary: '12 monthly % and amounts for ?method=EQUAL|SEASONAL|MANUAL&amount=',
    responses: { '200': { description: 'months' } },
  },
};
docsPaths['/budgets/{id}/workflow'] = {
  get: {
    tags: ['Budget'],
    summary: 'Approval Workflow card of a budget',
    responses: { '200': { description: 'workflow' } },
  },
};
docsPaths['/budgets/import-template'] = {
  get: {
    tags: ['Budget'],
    summary: 'Excel template of budget heads',
    responses: { '200': { description: 'xlsx' } },
  },
};
docsPaths['/budgets/{id}/import'] = {
  post: {
    tags: ['Budget'],
    summary: 'Import budget heads from the filled template: { file, replace? }',
    responses: {
      '200': { description: '{ imported, replaced, totalLines }' },
      '400': { description: 'rows.<n>.<field>' },
    },
  },
};
