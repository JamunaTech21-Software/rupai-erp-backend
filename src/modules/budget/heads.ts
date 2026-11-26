import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import { optionsRouter } from '../../lib/resource.js';

/**
 * RP1-242 B.2 Budget Heads and Sub Heads: a fixed list from the budget designs (decision 2026-11-26; no page, no
 * table), like the weather conditions. Each head has its category (OPEX / CAPEX) and a usual unit. Budget has its
 * own six departments, the ones the designs use (the Employees list is a different, HR one). Division / Cost
 * Center: the estate's divisions plus All Divisions, Estate Office and Factory.
 */
type Option = { value: string; label: string };

export const CATEGORY_LABELS: Record<string, string> = {
  OPEX: 'OPEX (Operational)',
  CAPEX: 'CAPEX (Capital)',
};

export const BUDGET_DEPARTMENTS: Option[] = [
  { value: 'AGRICULTURE', label: 'Agriculture (Field Operations)' },
  { value: 'FACTORY', label: 'Factory' },
  { value: 'HR_LABOUR', label: 'HR & Labour' },
  { value: 'ENGINEERING', label: 'Engineering & Maintenance' },
  { value: 'ADMINISTRATION', label: 'Administration' },
  { value: 'ESTATE_OPERATIONS', label: 'Estate Operations' },
];

export const UNITS: Option[] = [
  { value: 'KG', label: 'Kg' },
  { value: 'LTR', label: 'Ltr' },
  { value: 'TON', label: 'Ton' },
  { value: 'NOS', label: 'Nos' },
  { value: 'MAN_DAY', label: 'Man-day' },
  { value: 'KM', label: 'Km' },
  { value: 'SQFT', label: 'Sq ft' },
];

/** Cost centers that are not a division. */
export const OTHER_COST_CENTERS: Option[] = [
  { value: 'ALL_DIVISIONS', label: 'All Divisions' },
  { value: 'ESTATE_OFFICE', label: 'Estate Office' },
  { value: 'FACTORY', label: 'Factory' },
];

type Head = Option & { category: 'OPEX' | 'CAPEX'; unit: string | null; subHeads: Option[] };
const sub = (prefix: string, labels: string[]): Option[] =>
  labels.map((label) => ({
    value: `${prefix}_${label
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')}`,
    label,
  }));

export const BUDGET_HEADS: Head[] = [
  {
    value: 'LABOUR_WAGES',
    label: 'Labour & Wages',
    category: 'OPEX',
    unit: 'MAN_DAY',
    subHeads: sub('LABOUR', ['Permanent Labour', 'Casual Labour', 'Overtime', 'Ration & Benefits']),
  },
  {
    value: 'FERTILIZER',
    label: 'Fertilizer',
    category: 'OPEX',
    unit: 'KG',
    subHeads: sub('FERTILIZER', ['Urea', 'TSP', 'MOP', 'Zinc Sulphate', 'Dolomite']),
  },
  {
    value: 'PESTICIDE',
    label: 'Pesticide',
    category: 'OPEX',
    unit: 'LTR',
    subHeads: sub('PESTICIDE', ['Insecticide', 'Fungicide', 'Herbicide']),
  },
  {
    value: 'WEEDING_FIELD',
    label: 'Weeding & Field Maintenance',
    category: 'OPEX',
    unit: null,
    subHeads: sub('WEEDING', ['Manual Weeding', 'Chemical Weeding', 'Drain Cleaning']),
  },
  {
    value: 'FUEL_TRANSPORT',
    label: 'Fuel & Transport',
    category: 'OPEX',
    unit: 'LTR',
    subHeads: sub('FUEL', ['Diesel', 'Petrol', 'Lubricants', 'Vehicle Hire']),
  },
  {
    value: 'FACTORY_OPERATING',
    label: 'Factory Operating',
    category: 'OPEX',
    unit: null,
    subHeads: sub('FACTORY', ['Gas', 'Electricity', 'Packing Materials', 'Factory Consumables']),
  },
  {
    value: 'REPAIR_MAINTENANCE',
    label: 'Repair & Maintenance',
    category: 'OPEX',
    unit: null,
    subHeads: sub('MAINT', [
      'Machine Maintenance',
      'Field Maintenance',
      'Road & Drain Repair',
      'Building Repair',
    ]),
  },
  {
    value: 'ADMINISTRATION',
    label: 'Administration',
    category: 'OPEX',
    unit: null,
    subHeads: sub('ADMIN', ['Office Expenses', 'Communication', 'Travel', 'Professional Fees']),
  },
  {
    value: 'OTHERS',
    label: 'Others',
    category: 'OPEX',
    unit: null,
    subHeads: sub('OTHERS', ['Miscellaneous']),
  },
  {
    value: 'PLANTATION_DEVELOPMENT',
    label: 'Plantation Development',
    category: 'CAPEX',
    unit: null,
    subHeads: sub('PLANTATION', ['New Planting', 'Infilling', 'Shade Trees', 'Nursery']),
  },
  {
    value: 'MACHINERY_EQUIPMENT',
    label: 'Machinery & Equipment',
    category: 'CAPEX',
    unit: 'NOS',
    subHeads: sub('MACHINERY', ['Factory Machinery', 'Tractor & Vehicles', 'Irrigation Equipment']),
  },
  {
    value: 'BUILDING_INFRASTRUCTURE',
    label: 'Building & Infrastructure',
    category: 'CAPEX',
    unit: null,
    subHeads: sub('BUILDING', ['Buildings', 'Roads & Bridges', 'Labour Housing']),
  },
  {
    value: 'IT_EQUIPMENT',
    label: 'IT Equipment',
    category: 'CAPEX',
    unit: 'NOS',
    subHeads: sub('IT', ['Computers', 'Software', 'Network']),
  },
];

export const headOf = (value: unknown) => BUDGET_HEADS.find((h) => h.value === value) ?? null;
export const subHeadOf = (head: unknown, value: unknown) =>
  headOf(head)?.subHeads.find((s) => s.value === value) ?? null;
export const labelIn = (list: Option[], value: unknown) => list.find((o) => o.value === value)?.label ?? null;

const numbered = <T extends object>(list: T[]) => list.map((o, i) => ({ id: i + 1, ...o }));
const q = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

optionsRouter.get('/budget-heads', (req, res) => {
  const category = q(req.query.category).toUpperCase();
  const list = BUDGET_HEADS.filter((h) => !category || category === 'ALL' || h.category === category);
  res.json(
    numbered(
      list.map((h) => ({
        value: h.value,
        label: h.label,
        category: h.category,
        categoryLabel: CATEGORY_LABELS[h.category],
        defaultUnit: h.unit,
        defaultUnitLabel: labelIn(UNITS, h.unit),
      })),
    ),
  );
});

optionsRouter.get('/budget-sub-heads', (req, res) => {
  const head = q(req.query.head);
  const list = head
    ? (headOf(head)?.subHeads ?? []).map((s) => ({ ...s, head }))
    : BUDGET_HEADS.flatMap((h) => h.subHeads.map((s) => ({ ...s, head: h.value })));
  res.json(numbered(list));
});

optionsRouter.get('/budget-departments', (_req, res) => {
  res.json(numbered(BUDGET_DEPARTMENTS));
});

optionsRouter.get('/budget-units', (_req, res) => {
  res.json(numbered(UNITS));
});

/** Division / Cost Center: the estate's divisions, then the three others. */
optionsRouter.get('/budget-cost-centers', async (req, res) => {
  const estate = q(req.query.estate);
  const divisions = estate
    ? await db.division.findMany({
        where: { estate, deletedAt: null },
        orderBy: { divisionName: 'asc' },
        select: { id: true, divisionName: true },
      })
    : [];
  res.json(
    numbered([
      ...OTHER_COST_CENTERS.filter((o) => o.value === 'ALL_DIVISIONS'),
      ...divisions.map((d) => ({ value: d.id, label: d.divisionName, division: true })),
      ...OTHER_COST_CENTERS.filter((o) => o.value !== 'ALL_DIVISIONS'),
    ]),
  );
});

docsPaths['/options/budget-heads'] = {
  get: {
    tags: ['Budget'],
    summary: 'Budget heads (?category=OPEX|CAPEX) with category and usual unit',
    responses: { '200': { description: 'list' } },
  },
};
docsPaths['/options/budget-sub-heads'] = {
  get: {
    tags: ['Budget'],
    summary: 'Sub heads of ?head= (all when left out)',
    responses: { '200': { description: 'list' } },
  },
};
docsPaths['/options/budget-departments'] = {
  get: {
    tags: ['Budget'],
    summary: "Budget's six departments",
    responses: { '200': { description: 'list' } },
  },
};
docsPaths['/options/budget-units'] = {
  get: { tags: ['Budget'], summary: 'Units (Kg, Ltr, ...)', responses: { '200': { description: 'list' } } },
};
docsPaths['/options/budget-cost-centers'] = {
  get: {
    tags: ['Budget'],
    summary: 'Division / Cost Center for ?estate=: All Divisions, its divisions, Estate Office, Factory',
    responses: { '200': { description: 'list' } },
  },
};
