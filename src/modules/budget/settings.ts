import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { defineCustomWrite, pendingBadges, runCustomWrite } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { int, num, oneOf, text } from '../../lib/fields.js';
import { writeHistory } from '../../lib/history.js';
import { currentUserId } from '../../lib/resource.js';
import { toJson } from '../../lib/serialize.js';
import { sameFields } from '../../lib/unchanged.js';
import { z } from '../../lib/validation.js';
import { zodFields } from '../../middleware/error-handler.js';
import { todayDhaka } from '../weather/entries.js';

/**
 * RP1-239 B.1 Budget Settings (`/budget-settings`, `images/3.jpeg`): one saved row with the eight tabs of the
 * page. Saving (and Reset to Default) goes through approval, module `budget`. Other budget stories read it with
 * `budgetSettings()`: the year start sets the financial year, Budget Control applies to Expense Entry, the
 * Approval Workflow levels drive the budget workflow, thresholds colour utilization, Numbering makes the codes.
 * Integration toggles are saved only: nothing to connect to yet (decision 2026-11-26).
 */
export const BUDGET_SETTINGS_ID = 'BUDGETSETTINGS000000000000';
const VALIDATION = 'Please correct the highlighted fields.';

type Choice = { value: string; label: string };
export const CATEGORIES: Choice[] = [
  { value: 'ALL', label: 'All (OPEX & CAPEX)' },
  { value: 'OPEX', label: 'OPEX (Operational)' },
  { value: 'CAPEX', label: 'CAPEX (Capital)' },
];
const PERIODS: Choice[] = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'ANNUAL', label: 'Annual' },
];
const CURRENCIES: Choice[] = [{ value: 'BDT', label: 'BDT (৳)' }];
const DECIMALS = [0, 2];
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const FORECAST_METHODS: Choice[] = [
  { value: 'TREND', label: 'Trend (Actual Run Rate)' },
  { value: 'BUDGET', label: 'Budget-based (Remaining Allocation)' },
  { value: 'SEASONAL', label: 'Seasonal (Run Rate by Monthly %)' },
];
const TREND_MONTHS = [1, 2, 3, 6, 12];
const FREQUENCIES: Choice[] = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
];
export const ALLOCATION_METHODS: Choice[] = [
  { value: 'EQUAL', label: 'Equal Allocation' },
  { value: 'SEASONAL', label: 'Seasonal Allocation' },
  { value: 'MANUAL', label: 'Manual Allocation' },
];
const ROUNDINGS = [
  { value: 1, label: 'Nearest 1' },
  { value: 10, label: 'Nearest 10' },
  { value: 100, label: 'Nearest 100' },
  { value: 1000, label: 'Nearest 1,000' },
];
/** The four levels of the design, in their default order. */
export const APPROVAL_LEVELS = [
  { key: 'DEPARTMENT_HEAD', name: 'Department Head Review', role: 'Department Head' },
  { key: 'ESTATE_MANAGER', name: 'Estate Manager Review', role: 'Estate Manager' },
  { key: 'FINANCE', name: 'Finance Approval', role: 'Finance Manager' },
  { key: 'MANAGEMENT', name: 'Management Approval', role: 'General Manager' },
];
/** Numbered documents: the design's four plus Department Budget and Expense Entry (B.5, B.7). */
export const DOC_TYPES = [
  { docType: 'ANNUAL_BUDGET', label: 'Annual Budget', prefix: 'BUD' },
  { docType: 'DEPARTMENT_BUDGET', label: 'Department Budget', prefix: 'BUD-DEP' },
  { docType: 'REVISION', label: 'Budget Revision', prefix: 'REV' },
  { docType: 'TRANSFER', label: 'Budget Transfer', prefix: 'TRF' },
  { docType: 'ALLOCATION', label: 'Monthly Allocation', prefix: 'ALLOC' },
  { docType: 'EXPENSE', label: 'Expense Entry', prefix: 'EXP' },
] as const;
const ALERTS = [
  { key: 'warning', label: 'Department utilization reaches warning threshold' },
  { key: 'critical', label: 'Department utilization reaches critical threshold' },
  { key: 'overBudget', label: 'Budget exceeds approved limit (over budget)' },
  { key: 'forecastExceeds', label: 'Forecasted expense exceeds budget' },
  { key: 'abnormalConsumption', label: 'Monthly budget consumption is abnormal' },
] as const;
const INTEGRATIONS = [
  { key: 'integratePurchaseRequisition', label: 'Integrate with Purchase Requisition (PR)' },
  { key: 'integratePurchaseOrder', label: 'Integrate with Purchase Order (PO)' },
  { key: 'integrateAccountsPayable', label: 'Integrate with Expense / Accounts Payable' },
  { key: 'syncAccountingGl', label: 'Sync approved budget to accounting (GL)' },
  { key: 'emailNotifications', label: 'Send email notification for approvals and alerts' },
] as const;
/** The tea-season split the designs use (January first). */
export const SEASONAL_DEFAULT = [5, 5, 8, 10, 12, 12, 12, 12, 10, 7, 4, 3];

/** "2026-2027": the financial year that holds `date` (YYYY-MM-DD) for a year starting in `startMonth`. */
export function financialYearOf(date: string, startMonth: number) {
  const y = Number(date.slice(0, 4));
  const first = Number(date.slice(5, 7)) >= startMonth ? y : y - 1;
  return `${first}-${first + 1}`;
}
/** First and last day of a financial year: with a January start "2026-2027" is Jan 2026 – Dec 2026 (the design). */
export function financialYearRange(fy: string, startMonth: number) {
  const first = Number(fy.slice(0, 4));
  const from = new Date(Date.UTC(first, startMonth - 1, 1));
  const to = new Date(Date.UTC(first + 1, startMonth - 1, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
export const fyLabel = (fy: string) => fy.replace('-', '–');

export function defaultSettings(today = todayDhaka()) {
  return {
    defaultFinancialYear: financialYearOf(today, 1),
    defaultCategory: 'ALL',
    budgetPeriod: 'MONTHLY',
    currency: 'BDT',
    decimalPlaces: 2,
    yearStartMonth: 1,
    enforceBudgetLimit: true,
    includeCommitment: true,
    requireBudgetCheck: true,
    approvedBudgetOnly: true,
    allowOverspending: false,
    overspendingLimit: 5,
    approvalLevels: APPROVAL_LEVELS.map((l) => ({ ...l, required: true })),
    warningThreshold: 80,
    criticalThreshold: 90,
    overBudgetThreshold: 100,
    alertNotifications: {
      warning: true,
      critical: true,
      overBudget: true,
      forecastExceeds: true,
      abnormalConsumption: true,
    },
    abnormalPercent: 20,
    forecastMethod: 'TREND',
    trendMonths: 3,
    forecastIncludeCommitment: true,
    considerSeasonal: true,
    allowManualForecast: false,
    forecastFrequency: 'MONTHLY',
    allocationMethod: 'EQUAL',
    allowManualAllocation: true,
    carryForward: true,
    autoRedistribute: false,
    allocationRounding: 100,
    seasonalPercents: [...SEASONAL_DEFAULT],
    numbering: DOC_TYPES.map((d) => ({ docType: d.docType, prefix: d.prefix, digits: 4 })),
    integratePurchaseRequisition: true,
    integratePurchaseOrder: true,
    integrateAccountsPayable: true,
    syncAccountingGl: false,
    allowRevisionAfterPartial: true,
    lockApprovedBudget: false,
    emailNotifications: false,
  };
}
export type BudgetSettingsValues = ReturnType<typeof defaultSettings>;
type Level = BudgetSettingsValues['approvalLevels'][number];
type Numbering = BudgetSettingsValues['numbering'][number];

/** The saved settings, or the defaults before the first save. */
export async function budgetSettings(): Promise<
  BudgetSettingsValues & { updatedAt: Date | null; updatedBy: string | null }
> {
  const row = await db.budgetSettings.findUnique({ where: { id: BUDGET_SETTINGS_ID } });
  if (!row) return { ...defaultSettings(), updatedAt: null, updatedBy: null };
  const { id: _id, ...rest } = row;
  return {
    ...rest,
    overspendingLimit: Number(row.overspendingLimit),
    approvalLevels: row.approvalLevels as Level[],
    alertNotifications: row.alertNotifications as BudgetSettingsValues['alertNotifications'],
    seasonalPercents: row.seasonalPercents as number[],
    numbering: row.numbering as Numbering[],
  };
}

/** "BUD-YYYY-####" and its preview "BUD-2026-0001". */
const formatOf = (n: Numbering) => `${n.prefix}-YYYY-${'#'.repeat(n.digits)}`;
export const codeOf = (n: Numbering, year: number, seq: number) =>
  `${n.prefix}-${year}-${String(seq).padStart(n.digits, '0')}`;

// ---- Validation -------------------------------------------------------------------------------------------

const toggle = () =>
  z
    .preprocess(
      (v) => (v === 'true' ? true : v === 'false' ? false : v),
      z.boolean({ error: 'This field is required.' }),
    )
    .transform((v) => v === true);
const intIn = (list: readonly number[]) =>
  int().refine((v) => list.includes(v), 'Select a value from the list.');
const percent = (min: number, max: number) =>
  int().refine((v) => v >= min && v <= max, `Use ${min} to ${max}.`);
const values = (list: readonly { value: string }[]) => list.map((o) => o.value);

const schema = z.object({
  defaultFinancialYear: text(9).regex(/^\d{4}-\d{4}$/, 'Select a financial year from the list.'),
  defaultCategory: oneOf(values(CATEGORIES)),
  budgetPeriod: oneOf(values(PERIODS)),
  currency: oneOf(values(CURRENCIES)),
  decimalPlaces: intIn(DECIMALS),
  yearStartMonth: int().refine((v) => v >= 1 && v <= 12, 'Select a month from the list.'),
  enforceBudgetLimit: toggle(),
  includeCommitment: toggle(),
  requireBudgetCheck: toggle(),
  approvedBudgetOnly: toggle(),
  allowOverspending: toggle(),
  overspendingLimit: num('Must be 0 or more.').refine((v) => v <= 100, 'Use 0 to 100.'),
  approvalLevels: z
    .array(
      z.object({
        key: oneOf(APPROVAL_LEVELS.map((l) => l.key)),
        name: text(60),
        role: text(60),
        required: toggle(),
      }),
      { error: 'Send the 4 approval levels.' },
    )
    .length(4, 'Send the 4 approval levels.'),
  warningThreshold: percent(1, 200),
  criticalThreshold: percent(1, 200),
  overBudgetThreshold: percent(1, 200),
  alertNotifications: z.object(
    Object.fromEntries(ALERTS.map((a) => [a.key, toggle()])) as Record<
      (typeof ALERTS)[number]['key'],
      ReturnType<typeof toggle>
    >,
    { error: 'Send the alert notifications.' },
  ),
  abnormalPercent: percent(1, 100),
  forecastMethod: oneOf(values(FORECAST_METHODS)),
  trendMonths: intIn(TREND_MONTHS),
  forecastIncludeCommitment: toggle(),
  considerSeasonal: toggle(),
  allowManualForecast: toggle(),
  forecastFrequency: oneOf(values(FREQUENCIES)),
  allocationMethod: oneOf(values(ALLOCATION_METHODS)),
  allowManualAllocation: toggle(),
  carryForward: toggle(),
  autoRedistribute: toggle(),
  allocationRounding: intIn(ROUNDINGS.map((r) => r.value)),
  seasonalPercents: z
    .array(num('Must be 0 or more.'), { error: 'Send the 12 monthly %.' })
    .length(12, 'Send the 12 monthly %.'),
  numbering: z
    .array(
      z.object({
        docType: oneOf(DOC_TYPES.map((d) => d.docType)),
        prefix: text(10)
          .transform((v) => v.toUpperCase())
          .refine(
            (v) => /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/.test(v),
            'Use letters, digits and dashes, e.g. BUD.',
          ),
        digits: int().refine((v) => v >= 3 && v <= 6, 'Use 3 to 6 digits.'),
      }),
      { error: 'Send the numbering of every document.' },
    )
    .length(DOC_TYPES.length, 'Send the numbering of every document.'),
  integratePurchaseRequisition: toggle(),
  integratePurchaseOrder: toggle(),
  integrateAccountsPayable: toggle(),
  syncAccountingGl: toggle(),
  allowRevisionAfterPartial: toggle(),
  lockApprovedBudget: toggle(),
  emailNotifications: toggle(),
});

function check(v: z.infer<typeof schema>) {
  const fields: Record<string, string> = {};
  const [a, b] = [Number(v.defaultFinancialYear.slice(0, 4)), Number(v.defaultFinancialYear.slice(5))];
  if (b !== a + 1) fields.defaultFinancialYear = 'Select a financial year from the list.';
  if (v.warningThreshold >= v.criticalThreshold)
    fields.warningThreshold = 'The warning threshold must be below the critical threshold.';
  if (v.criticalThreshold > v.overBudgetThreshold)
    fields.criticalThreshold = 'The critical threshold must not be above the over budget threshold.';
  const keys = v.approvalLevels.map((l) => l.key);
  if (new Set(keys).size !== keys.length) fields.approvalLevels = 'Each approval level once.';
  else if (!v.approvalLevels.some((l) => l.required))
    fields.approvalLevels = 'At least one approval level must be required.';
  const sum = v.seasonalPercents.reduce((s, p) => s + p, 0);
  if (Math.abs(sum - 100) > 0.001)
    fields.seasonalPercents = `The 12 monthly % must add up to 100 (now ${Math.round(sum * 100) / 100}).`;
  const docs = v.numbering.map((n) => n.docType);
  if (new Set(docs).size !== docs.length) fields.numbering = 'Each document once.';
  v.numbering.forEach((n, i) => {
    if (v.numbering.findIndex((o) => o.prefix === n.prefix) !== i)
      fields[`numbering.${i}.prefix`] = 'This prefix is already used.';
  });
  return fields;
}

function parse(body: unknown) {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new AppError('VALIDATION', VALIDATION, zodFields(parsed.error));
  const fields = check(parsed.data);
  if (Object.keys(fields).length) throw new AppError('VALIDATION', VALIDATION, fields);
  // Keep the design's order of documents.
  const numbering = DOC_TYPES.map(
    (d) => parsed.data.numbering.find((n) => n.docType === d.docType) as Numbering,
  );
  return { ...parsed.data, numbering };
}

const write = defineCustomWrite({
  key: 'budgetSettings',
  module: 'budget',
  resource: 'budgetSettings',
  page: 'Budget Settings',
  plan: async ({ body }) => {
    const reset = (body as { reset?: boolean } | null)?.reset === true;
    const values = reset ? defaultSettings() : parse(body);
    const before = await db.budgetSettings.findUnique({ where: { id: BUDGET_SETTINGS_ID } });
    const oldData = before ? toJson({ ...before, updatedAt: undefined, updatedBy: undefined }) : null;
    const compare = before ? { ...before, overspendingLimit: Number(before.overspendingLimit) } : null;
    return {
      recordId: BUDGET_SETTINGS_ID,
      summary: reset ? 'Reset to default' : 'Budget settings',
      oldData,
      newData: values,
      unchanged: sameFields(values, compare),
      run: async (tx, userId, approvalId) => {
        await tx.budgetSettings.upsert({
          where: { id: BUDGET_SETTINGS_ID },
          create: { id: BUDGET_SETTINGS_ID, ...values, updatedBy: userId },
          update: { ...values, updatedBy: userId },
        });
        await writeHistory(tx, {
          resource: 'budgetSettings',
          recordId: BUDGET_SETTINGS_ID,
          action: before ? 'update' : 'create',
          oldData: oldData ?? undefined,
          newData: values,
          userId,
          approvalId,
        });
      },
    };
  },
});

async function answer() {
  const s = await budgetSettings();
  const badges = await pendingBadges('budgetSettings', [BUDGET_SETTINGS_ID]);
  const user = s.updatedBy
    ? await db.user.findUnique({ where: { id: s.updatedBy }, select: { name: true } })
    : null;
  const year = Number(todayDhaka().slice(0, 4));
  return toJson({
    id: BUDGET_SETTINGS_ID,
    ...s,
    financialYearRange: financialYearRange(s.defaultFinancialYear, s.yearStartMonth),
    numbering: s.numbering.map((n) => ({
      ...n,
      label: DOC_TYPES.find((d) => d.docType === n.docType)?.label ?? n.docType,
      format: formatOf(n),
      preview: codeOf(n, year, 1),
    })),
    integrationStatus: Object.fromEntries(INTEGRATIONS.map((i) => [i.key, 'Not connected yet'])),
    auditTrail: true,
    updatedByName: user?.name ?? null,
    pendingRequest: badges.get(BUDGET_SETTINGS_ID) ?? null,
  });
}

export const budgetSettingsRouter = Router();

budgetSettingsRouter.get('/filter-options', (_req, res) => {
  const numbered = <T extends object>(list: T[]) => list.map((o, i) => ({ id: i + 1, ...o }));
  const today = todayDhaka();
  const current = Number(financialYearOf(today, 1).slice(0, 4));
  const years = [-2, -1, 0, 1, 2].map((d) => `${current + d}-${current + d + 1}`);
  res.json({
    financialYears: numbered(years.map((fy) => ({ value: fy, label: fyLabel(fy) }))),
    categories: numbered(CATEGORIES),
    budgetPeriods: numbered(PERIODS),
    currencies: numbered(CURRENCIES),
    decimalPlaces: numbered(DECIMALS.map((d) => ({ value: d, label: String(d) }))),
    months: numbered(MONTH_NAMES.map((m, i) => ({ value: i + 1, label: m }))),
    approvalLevels: numbered(APPROVAL_LEVELS),
    alertNotifications: numbered([...ALERTS]),
    forecastMethods: numbered(FORECAST_METHODS),
    trendMonths: numbered(TREND_MONTHS.map((m) => ({ value: m, label: String(m) }))),
    forecastFrequencies: numbered(FREQUENCIES),
    allocationMethods: numbered(ALLOCATION_METHODS),
    allocationRoundings: numbered(ROUNDINGS),
    documentTypes: numbered(DOC_TYPES.map((d) => ({ value: d.docType, label: d.label }))),
    integrations: numbered(INTEGRATIONS.map((i) => ({ ...i, status: 'Not connected yet' }))),
  });
});

budgetSettingsRouter.get('/', async (_req, res) => {
  res.json(await answer());
});

budgetSettingsRouter.put('/', async (req, res) => {
  const { queued } = await runCustomWrite(
    write,
    { params: {}, body: req.body, action: 'update' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  res.json(await answer());
});

budgetSettingsRouter.post('/reset', async (req, res) => {
  const { queued } = await runCustomWrite(
    write,
    { params: {}, body: { reset: true }, action: 'update' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  res.json(await answer());
});

docsPaths['/budget-settings'] = {
  get: {
    tags: ['Budget'],
    summary: 'Budget Settings (all eight tabs)',
    responses: { '200': { description: 'settings' } },
  },
  put: {
    tags: ['Budget'],
    summary: 'Save Budget Settings (the whole object); through approval (module budget) when On',
    responses: {
      '200': { description: 'saved' },
      '202': { description: 'sent for approval' },
      '400': { description: 'fields' },
    },
  },
};
docsPaths['/budget-settings/reset'] = {
  post: {
    tags: ['Budget'],
    summary: 'Reset to Default; through approval when On',
    responses: { '200': { description: 'reset' }, '202': { description: 'sent for approval' } },
  },
};
docsPaths['/budget-settings/filter-options'] = {
  get: {
    tags: ['Budget'],
    summary: 'Dropdown lists of Budget Settings',
    responses: { '200': { description: 'lists' } },
  },
};
