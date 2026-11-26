import { join } from 'node:path';

import ExcelJS from 'exceljs';
import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { list, longText, num, oneOf, optOneOf, optText, ref, text } from '../../lib/fields.js';
import { writeHistory } from '../../lib/history.js';
import { newId } from '../../lib/ids.js';
import { currentUserId, defineResource } from '../../lib/resource.js';
import { uploadRoot } from '../files/service.js';
import { z } from '../../lib/validation.js';
import {
  MONTH_SHORT,
  attachmentProblems,
  cellValue,
  methodPercents,
  monthAmounts,
  norm,
  round2,
} from './budgets.js';
import {
  BUDGET_DEPARTMENTS,
  BUDGET_HEADS,
  CATEGORY_LABELS,
  OTHER_COST_CENTERS,
  UNITS,
  headOf,
  labelIn,
  subHeadOf,
} from './heads.js';
import { ALLOCATION_METHODS, budgetSettings, codeOf, fyLabel } from './settings.js';
import { EDITABLE, STATUSES, registerWorkflowDoc, statusLabel, workflowView } from './workflow.js';

/**
 * RP1-246 B.4 Budget Entry (`/budget-entry`, `images/12.jpeg`), also the record of B.5 Add Department Budget
 * (`images/10.jpeg`): `/department-budgets`. One department's detailed budget (heads with sub head and unit) inside
 * an Approved annual budget; estate and financial year come from it. Department limit = the department's total in
 * the annual budget. Budget Appropriation Check: limit, already allocated (the department's other Pending and
 * Approved budgets; drafts do not hold the limit), after this one; Over Limit can be saved as Draft but not submitted. The form saves drafts
 * only; Submit for Approval is the budget workflow (`DEPARTMENT_BUDGET`).
 */
const CATEGORIES = [
  { value: 'OPEX', label: 'OPEX (Operational)' },
  { value: 'CAPEX', label: 'CAPEX (Capital)' },
];
const BUDGET_TYPES = [{ value: 'ANNUAL', label: 'Annual' }];
const VALIDATION = 'Please correct the highlighted fields.';
const valuesOf = (l: { value: string }[]) => l.map((o) => o.value);
const OTHERS = valuesOf(OTHER_COST_CENTERS);
const numbered = <T extends object>(l: T[]) => l.map((o, i) => ({ id: i + 1, ...o }));

const lineSchema = z.object({
  head: oneOf(valuesOf(BUDGET_HEADS)),
  subHead: optText(60),
  unit: optOneOf(valuesOf(UNITS)),
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

const schema = z.object({
  budgetName: text(150),
  budget: ref(),
  budgetType: oneOf(valuesOf(BUDGET_TYPES)),
  department: oneOf(valuesOf(BUDGET_DEPARTMENTS)),
  // Add Department Budget has no Division field: the whole department.
  costCenter: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? 'ALL_DIVISIONS' : v),
    text(26),
  ),
  category: oneOf(valuesOf(CATEGORIES)),
  reference: optText(120),
  justification: longText(),
  remarks: longText(),
  attachments: list(),
});

/** The department's place in its annual budget; `amount` is this budget's total, `exclude` this budget's id. */
export async function appropriation(budgetId: string, department: string, amount: number, exclude?: string) {
  const annual = await db.budget.findFirst({
    where: { id: budgetId, deletedAt: null },
    include: { lines: { select: { department: true, annualAmount: true } } },
  });
  if (!annual) return null;
  const others = await db.departmentBudget.findMany({
    where: {
      budget: budgetId,
      deletedAt: null,
      status: { in: ['PENDING', 'APPROVED'] },
      ...(exclude ? { NOT: { id: exclude } } : {}),
    },
    select: { department: true, lines: { select: { annualAmount: true } } },
  });
  const sum = (l: { annualAmount: unknown }[]) => round2(l.reduce((s, x) => s + Number(x.annualAmount), 0));
  const estateTotal = sum(annual.lines);
  const limit = sum(annual.lines.filter((l) => l.department === department));
  const allocatedAll = round2(others.reduce((s, o) => s + sum(o.lines), 0));
  const already = round2(
    others.filter((o) => o.department === department).reduce((s, o) => s + sum(o.lines), 0),
  );
  const after = round2(already + amount);
  const within = after <= limit;
  return {
    annualBudget: annual.id,
    annualBudgetCode: annual.budgetCode,
    annualBudgetStatus: annual.status,
    estateTotalBudget: estateTotal,
    allocatedToDepartments: allocatedAll,
    thisDepartment: round2(amount),
    remainingForAllocation: round2(estateTotal - allocatedAll - amount),
    departmentLimit: limit,
    alreadyAllocated: already,
    afterThisAllocation: after,
    remainingInDepartment: round2(limit - after),
    status: within ? 'WITHIN_LIMIT' : 'OVER_LIMIT',
    statusLabel: within ? 'Within Limit' : 'Over Limit',
  };
}

async function nextCode(financialYear: string) {
  const s = await budgetSettings();
  const n = s.numbering.find((x) => x.docType === 'DEPARTMENT_BUDGET') ?? {
    docType: 'DEPARTMENT_BUDGET',
    prefix: 'BUD-DEP',
    digits: 4,
  };
  const year = Number(financialYear.slice(0, 4));
  const start = `${n.prefix}-${year}-`;
  const rows = await db.departmentBudget.findMany({
    where: { code: { startsWith: start } },
    select: { code: true },
  });
  const max = rows.reduce((top, r) => Math.max(top, Number(r.code.slice(start.length)) || 0), 0);
  return codeOf(n, year, max + 1);
}

const lineLabels = (rows: Record<string, unknown>[]) =>
  rows.map((r) => ({
    ...r,
    headLabel: headOf(r.head)?.label ?? null,
    category: headOf(r.head)?.category ?? null,
    categoryLabel: CATEGORY_LABELS[headOf(r.head)?.category ?? ''] ?? null,
    subHeadLabel: subHeadOf(r.head, r.subHead)?.label ?? null,
    unitLabel: labelIn(UNITS, r.unit),
    allocationMethodLabel: labelIn(ALLOCATION_METHODS, r.allocationMethod),
  }));

export const departmentBudgetsRouter = defineResource('/department-budgets', {
  name: 'departmentBudget',
  label: 'Department budget',
  module: 'budget',
  page: 'Department Budget',
  describe: (r) => show(r.code, paren(r.budgetName)),
  model: 'departmentBudget',
  schema,
  search: ['code', 'budgetName', 'reference'],
  filters: ['estate', 'financialYear', 'budget', 'department', 'status', 'category'],
  refs: { estate: { model: 'estate', label: 'estateName' } },
  files: ['attachments'],
  children: [
    {
      key: 'lines',
      model: 'departmentBudgetLine',
      parentKey: 'departmentBudgetId',
      schema: lineSchema,
      compute: (row) => ({
        ...row,
        monthAmounts: monthAmounts(Number(row.annualAmount), row.monthPercents as number[]),
      }),
      decorate: lineLabels,
    },
  ],
  orderBy: [{ financialYear: 'desc' }, { code: 'desc' }, { id: 'asc' }],
  skipApproval: () => true,
  check: async (values, id, rows) => {
    const fields: Record<string, string> = {};
    if (id) {
      const before = await db.departmentBudget.findFirst({
        where: { id, deletedAt: null },
        select: { status: true },
      });
      if (before && !EDITABLE.includes(before.status))
        fields.status = `This department budget is ${statusLabel(before.status)}: only a Draft or Returned one can be edited.`;
    }
    const annual = await db.budget.findFirst({
      where: { id: String(values.budget), deletedAt: null },
      include: { lines: { select: { department: true } } },
    });
    if (!annual) fields.budget = 'Select an annual budget.';
    else if (annual.status !== 'APPROVED')
      fields.budget = `${annual.budgetCode} is ${statusLabel(annual.status)}: pick an Approved annual budget.`;
    else if (!annual.lines.some((l) => l.department === values.department))
      fields.department = `${labelIn(BUDGET_DEPARTMENTS, values.department)} has no budget in ${annual.budgetCode}.`;
    if (annual && typeof values.costCenter === 'string' && !OTHERS.includes(values.costCenter)) {
      const division = await db.division.findFirst({
        where: { id: values.costCenter, estate: annual.estate, deletedAt: null },
        select: { id: true },
      });
      if (!division)
        fields.costCenter = 'Select a division of this estate or another cost center from the list.';
    }
    Object.assign(fields, await attachmentProblems(values.attachments));
    ((rows?.lines ?? []) as Record<string, unknown>[]).forEach((l, i) => {
      const head = headOf(l.head);
      if (head && head.category !== values.category)
        fields[`lines.${i}.head`] =
          `${head.label} is ${head.category}; this budget is ${String(values.category)}.`;
      if (l.subHead !== null && l.subHead !== undefined && !subHeadOf(l.head, l.subHead))
        fields[`lines.${i}.subHead`] = 'Select a sub head of this budget head.';
      const sum = ((l.monthPercents ?? []) as number[]).reduce((s, p) => s + p, 0);
      if (Math.abs(sum - 100) > 0.01)
        fields[`lines.${i}.monthPercents`] = `The 12 monthly % must add up to 100 (now ${round2(sum)}).`;
    });
    return fields;
  },
  // Estate and financial year always follow the annual budget.
  onSave: async (values) => {
    const annual = await db.budget.findUnique({
      where: { id: String(values.budget) },
      select: { estate: true, financialYear: true },
    });
    return annual ? { estate: annual.estate, financialYear: annual.financialYear } : {};
  },
  onCreate: async (values) => ({ code: await nextCode(String(values.financialYear)), status: 'DRAFT' }),
  extend: (row) => ({
    financialYearLabel: fyLabel(String(row.financialYear)),
    budgetTypeLabel: labelIn(BUDGET_TYPES, row.budgetType),
    departmentLabel: labelIn(BUDGET_DEPARTMENTS, row.department),
    categoryLabel: labelIn(CATEGORIES, row.category),
    statusLabel: statusLabel(row.status),
    preparedBy: row.createdBy,
    editable: EDITABLE.includes(String(row.status)),
  }),
  enrich: async (rows) => {
    const ids = rows.map((r) => String(r.id));
    const lines = await db.departmentBudgetLine.findMany({
      where: { departmentBudgetId: { in: ids } },
      select: { departmentBudgetId: true, annualAmount: true, monthAmounts: true },
    });
    const annuals = new Map(
      (
        await db.budget.findMany({
          where: { id: { in: [...new Set(rows.map((r) => String(r.budget)))] } },
          select: { id: true, budgetCode: true, budgetName: true, status: true },
        })
      ).map((b) => [b.id, b]),
    );
    const divisionIds = [
      ...new Set(rows.map((r) => String(r.costCenter)).filter((v) => !OTHERS.includes(v))),
    ];
    const divisions = new Map(
      divisionIds.length
        ? (
            await db.division.findMany({
              where: { id: { in: divisionIds } },
              select: { id: true, divisionName: true },
            })
          ).map((d) => [d.id, d.divisionName])
        : [],
    );
    const out = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const mine = lines.filter((l) => l.departmentBudgetId === r.id);
      const annualAmount = round2(mine.reduce((s, l) => s + Number(l.annualAmount), 0));
      const months = Array.from({ length: 12 }, (_, i) =>
        round2(mine.reduce((s, l) => s + Number((l.monthAmounts as number[])[i] ?? 0), 0)),
      );
      const monthlyTotal = round2(months.reduce((s, v) => s + v, 0));
      const a = annuals.get(String(r.budget));
      out.set(String(r.id), {
        annualBudgetCode: a?.budgetCode ?? null,
        annualBudgetName: a?.budgetName ?? null,
        costCenterLabel:
          labelIn(OTHER_COST_CENTERS, r.costCenter) ?? divisions.get(String(r.costCenter)) ?? null,
        annualAmount,
        monthlyTotal,
        allocationPercent: annualAmount ? round2((monthlyTotal / annualAmount) * 100) : 0,
        monthTotals: months,
        totalLines: mine.length,
      });
    }
    return out;
  },
  deleteCheck: (row) =>
    Promise.resolve(
      EDITABLE.includes(String(row.status)) || row.status === 'REJECTED'
        ? undefined
        : `This department budget is ${statusLabel(row.status)}: only a Draft, Returned or Rejected one can be deleted.`,
    ),
  export: {
    fileName: 'department-budgets',
    sheet: 'Department Budgets',
    columns: [
      { header: 'SL', value: (_r, i) => i + 1, width: 6 },
      { header: 'Code', value: (r) => r.code, width: 20 },
      { header: 'Budget Name', value: (r) => r.budgetName, width: 32 },
      { header: 'Annual Budget', value: (r) => r.annualBudgetCode, width: 16 },
      { header: 'Financial Year', value: (r) => r.financialYearLabel, width: 14 },
      { header: 'Estate', value: (r) => r.estateName, width: 24 },
      { header: 'Department', value: (r) => r.departmentLabel, width: 28 },
      { header: 'Division / Cost Center', value: (r) => r.costCenterLabel, width: 22 },
      { header: 'Category', value: (r) => r.categoryLabel, width: 18 },
      { header: 'Annual Amount (৳)', value: (r) => r.annualAmount, width: 18, numFmt: '#,##0' },
      { header: 'Status', value: (r) => r.statusLabel, width: 12 },
    ],
  },
  options: {
    path: 'department-budgets',
    label: (row) => `${String(row.code)} — ${String(row.budgetName)}`,
    filters: ['estate', 'financialYear', 'budget', 'department', 'status'],
  },
});

registerWorkflowDoc({
  docType: 'DEPARTMENT_BUDGET',
  label: 'Department budget',
  resource: 'departmentBudget',
  find: (id) => db.departmentBudget.findFirst({ where: { id } }),
  update: async (tx, id, from, data) =>
    (
      await tx.departmentBudget.updateMany({
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
    const lines = await db.departmentBudgetLine.findMany({
      where: { departmentBudgetId: String(row.id) },
      select: { annualAmount: true },
    });
    if (!lines.length) return 'Add at least one budget line before submitting.';
    const total = round2(lines.reduce((s, l) => s + Number(l.annualAmount), 0));
    const a = await appropriation(String(row.budget), String(row.department), total, String(row.id));
    if (!a || a.annualBudgetStatus !== 'APPROVED') return 'The annual budget is no longer Approved.';
    if (a.status === 'OVER_LIMIT')
      return `Over the department limit: ${a.afterThisAllocation.toLocaleString('en-IN')} of ${a.departmentLimit.toLocaleString('en-IN')} taka. Lower the amounts first.`;
    return undefined;
  },
});

export const departmentBudgetExtrasRouter = Router();

departmentBudgetExtrasRouter.get('/filter-options', async (_req, res) => {
  const s = await budgetSettings();
  res.json({
    departments: numbered(BUDGET_DEPARTMENTS),
    categories: numbered(CATEGORIES),
    budgetTypes: numbered(BUDGET_TYPES),
    statuses: numbered(STATUSES),
    allocationMethods: numbered(ALLOCATION_METHODS),
    defaultAllocationMethod: s.allocationMethod,
    seasonalPercents: s.seasonalPercents,
    equalPercents: methodPercents('EQUAL', s.seasonalPercents),
    allocationMethodDetails: [
      {
        value: 'EQUAL',
        title: 'Equal Allocation',
        text: 'The annual amount is split equally over the 12 months.',
      },
      {
        value: 'SEASONAL',
        title: 'Seasonal Allocation',
        text: 'Allocate budget based on tea season and operational need (% can be customized for each month).',
      },
      {
        value: 'MANUAL',
        title: 'Manual Allocation',
        text: 'Enter the % of each month yourself; they must add up to 100 %.',
      },
    ],
    units: numbered(UNITS),
    attachmentTypes: ['PDF', 'XLSX', 'JPG', 'PNG'],
  });
});

departmentBudgetExtrasRouter.get('/next-code', async (req, res) => {
  const annual =
    typeof req.query.budget === 'string'
      ? await db.budget.findFirst({
          where: { id: req.query.budget, deletedAt: null },
          select: { financialYear: true },
        })
      : null;
  res.json({ code: await nextCode(annual?.financialYear ?? (await budgetSettings()).defaultFinancialYear) });
});

/** Budget Summary and Budget Appropriation Check of the form, before saving. */
departmentBudgetExtrasRouter.get('/appropriation-check', async (req, res) => {
  const q = (k: string) => (typeof req.query[k] === 'string' ? req.query[k].trim() : '');
  const fields: Record<string, string> = {};
  if (!q('budget')) fields.budget = 'Select an annual budget.';
  if (!valuesOf(BUDGET_DEPARTMENTS).includes(q('department')))
    fields.department = 'Select a value from the list.';
  const amount = q('amount') === '' ? 0 : Number(q('amount'));
  if (!(amount >= 0)) fields.amount = 'Must be 0 or more.';
  if (Object.keys(fields).length) throw new AppError('VALIDATION', VALIDATION, fields);
  const a = await appropriation(q('budget'), q('department'), amount, q('exclude') || undefined);
  if (!a) throw notFound('Budget');
  res.json(a);
});

departmentBudgetExtrasRouter.get('/:id/workflow', async (req, res) => {
  const row = await db.departmentBudget.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!row) throw notFound('Department budget');
  res.json(await workflowView('DEPARTMENT_BUDGET', row));
});

docsPaths['/department-budgets/filter-options'] = {
  get: {
    tags: ['Budget'],
    summary: 'Budget Entry / Add Department Budget lists',
    responses: { '200': { description: 'lists' } },
  },
};
docsPaths['/department-budgets/next-code'] = {
  get: {
    tags: ['Budget'],
    summary: 'Next BUD-DEP code for ?budget=<annual budget id>',
    responses: { '200': { description: '{ code }' } },
  },
};
docsPaths['/department-budgets/appropriation-check'] = {
  get: {
    tags: ['Budget'],
    summary: 'Budget Summary + Appropriation Check for ?budget=&department=&amount=[&exclude=<this id>]',
    responses: { '200': { description: 'check' } },
  },
};
docsPaths['/department-budgets/{id}/workflow'] = {
  get: {
    tags: ['Budget'],
    summary: 'Approval Workflow card of a department budget',
    responses: { '200': { description: 'workflow' } },
  },
};

// ---- Import (Excel) of department budgets ---------------------------------------------------------------------

const TEMPLATE = [
  'Department',
  'Division / Cost Center',
  'Budget Head',
  'Sub Head',
  'Unit',
  'Annual Amount (৳)',
  'Allocation Method',
  ...MONTH_SHORT.map((m) => `${m} %`),
];

departmentBudgetExtrasRouter.get('/import-template', async (_req, res) => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Department Budgets');
  sheet.addRow(TEMPLATE);
  sheet.getRow(1).font = { bold: true };
  sheet.addRow([
    'Agriculture (Field Operations)',
    'All Divisions',
    'Fertilizer',
    'Urea',
    'Kg',
    1200000,
    'Seasonal Allocation',
  ]);
  sheet.addRow([
    'Agriculture (Field Operations)',
    'All Divisions',
    'Pesticide',
    'Insecticide',
    'Ltr',
    500000,
    'Equal Allocation',
  ]);
  sheet.columns.forEach((c, i) => (c.width = i < 7 ? 26 : 8));
  res.setHeader('Content-Disposition', 'attachment; filename="department-budgets-template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(Buffer.from(await book.xlsx.writeBuffer()));
});

/**
 * `POST /department-budgets/import { budget: <Approved annual budget id>, file: <.xlsx id> }`: the rows become Draft
 * department budgets, one per department, category (from the head) and cost center, named "<Department> –
 * OPEX|CAPEX Budget". Any wrong row refuses the whole file (`rows.<excel row>.<field>`).
 */
departmentBudgetExtrasRouter.post('/import', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const annual =
    typeof body.budget === 'string'
      ? await db.budget.findFirst({
          where: { id: body.budget, deletedAt: null },
          include: { lines: { select: { department: true } } },
        })
      : null;
  if (!annual || annual.status !== 'APPROVED')
    throw new AppError('VALIDATION', VALIDATION, { budget: 'Select an Approved annual budget.' });
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
    where: { estate: annual.estate, deletedAt: null },
    select: { id: true, divisionName: true },
  });
  const inBudget = new Set(annual.lines.map((l) => l.department));
  const fields: Record<string, string> = {};
  const groups = new Map<
    string,
    { department: string; category: string; costCenter: string; lines: Record<string, unknown>[] }
  >();
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const v = (i: number) => cellValue(row.getCell(i).value);
    if ([1, 3, 6].every((i) => norm(v(i)) === '')) return;
    const at = (k: string, m: string) => (fields[`rows.${n}.${k}`] ??= m);
    const dept = BUDGET_DEPARTMENTS.find((d) =>
      [norm(d.label), norm(d.value), norm(d.label.replace(/ \(.*\)$/, ''))].includes(norm(v(1))),
    );
    if (!dept) at('department', 'Unknown department.');
    else if (!inBudget.has(dept.value))
      at('department', `${dept.label} has no budget in ${annual.budgetCode}.`);
    const ccText = norm(v(2)) || 'all divisions';
    const costCenter =
      OTHER_COST_CENTERS.find((o) => norm(o.label) === ccText)?.value ??
      divisions.find((d) => norm(d.divisionName) === ccText)?.id;
    if (!costCenter)
      at('costCenter', 'Use All Divisions, a division of this estate, Estate Office or Factory.');
    const head = BUDGET_HEADS.find((h) => norm(h.label) === norm(v(3)) || norm(h.value) === norm(v(3)));
    if (!head) at('head', 'Unknown budget head.');
    const subText = norm(v(4));
    const sub =
      head && subText
        ? head.subHeads.find((x) => norm(x.label) === subText || norm(x.value) === subText)
        : null;
    if (head && subText && !sub) at('subHead', `Not a sub head of ${head.label}.`);
    const unitText = norm(v(5));
    const unit = unitText
      ? UNITS.find((u) => norm(u.label) === unitText || norm(u.value) === unitText)
      : null;
    if (unitText && !unit) at('unit', 'Unknown unit.');
    const amount = Number(v(6));
    if (!(amount > 0) || amount >= 1e13) at('annualAmount', 'Must be more than 0.');
    const methodText = norm(v(7));
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
      percents = MONTH_SHORT.map((_, i) => Number(v(8 + i)));
      if (percents.some((p) => !Number.isFinite(p) || p < 0 || p > 100))
        at('monthPercents', 'Manual Allocation needs the 12 monthly % (0 to 100).');
      else if (Math.abs(percents.reduce((x, p) => x + p, 0) - 100) > 0.01)
        at('monthPercents', 'The 12 monthly % must add up to 100.');
    }
    if (dept && head && costCenter && method && amount > 0) {
      const key = `${dept.value}|${head.category}|${costCenter}`;
      const g = groups.get(key) ?? { department: dept.value, category: head.category, costCenter, lines: [] };
      g.lines.push({
        head: head.value,
        subHead: sub?.value ?? null,
        unit: unit?.value ?? null,
        annualAmount: amount,
        allocationMethod: method,
        monthPercents: percents,
        monthAmounts: monthAmounts(amount, percents),
      });
      groups.set(key, g);
    }
  });
  if (Object.keys(fields).length)
    throw new AppError('VALIDATION', 'Some rows of the file are wrong; nothing was imported.', fields);
  if (!groups.size) throw new AppError('VALIDATION', VALIDATION, { file: 'The file has no budget lines.' });
  const userId = currentUserId(req);
  const created: { id: string; code: string; budgetName: string; lines: number }[] = [];
  // Codes one after another; the whole file is one transaction.
  const firstCode = await nextCode(annual.financialYear);
  const prefix = firstCode.slice(0, firstCode.lastIndexOf('-') + 1);
  const digits = firstCode.length - prefix.length;
  let seq = Number(firstCode.slice(prefix.length));
  await db.$transaction(async (tx) => {
    for (const g of groups.values()) {
      const id = newId();
      const code = `${prefix}${String(seq++).padStart(digits, '0')}`;
      const budgetName = `${labelIn(BUDGET_DEPARTMENTS, g.department)?.replace(/ \(.*\)$/, '') ?? g.department} – ${g.category} Budget`;
      await tx.departmentBudget.create({
        data: {
          id,
          code,
          budgetName,
          budget: annual.id,
          financialYear: annual.financialYear,
          estate: annual.estate,
          budgetType: 'ANNUAL',
          department: g.department,
          costCenter: g.costCenter,
          category: g.category,
          attachments: [],
          status: 'DRAFT',
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await tx.departmentBudgetLine.createMany({
        data: g.lines.map((l, i) => ({
          ...(l as object),
          id: newId(),
          departmentBudgetId: id,
          position: i,
        })) as never,
      });
      await writeHistory(tx, {
        resource: 'departmentBudget',
        recordId: id,
        action: 'create',
        newData: { code, budgetName, imported: file.name, lines: g.lines.length },
        userId,
        approvalId: null,
      });
      created.push({ id, code, budgetName, lines: g.lines.length });
    }
  });
  res.status(201).json({ created: created.length, departmentBudgets: created });
});

docsPaths['/department-budgets/import-template'] = {
  get: {
    tags: ['Budget'],
    summary: 'Excel template of department budget lines',
    responses: { '200': { description: 'xlsx' } },
  },
};
docsPaths['/department-budgets/import'] = {
  post: {
    tags: ['Budget'],
    summary: 'Import Draft department budgets: { budget, file }',
    responses: {
      '201': { description: '{ created, departmentBudgets }' },
      '400': { description: 'rows.<n>.<field>' },
    },
  },
};
