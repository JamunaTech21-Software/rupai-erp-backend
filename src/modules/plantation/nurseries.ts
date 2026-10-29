import { type Request, Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { int, longText, num, oneOf, optInt, ref, reqDate, text } from '../../lib/fields.js';
import { readHistory, writeHistory } from '../../lib/history.js';
import { newId } from '../../lib/ids.js';
import { currentUserId, defineResource } from '../../lib/resource.js';
import { zodFields } from '../../middleware/error-handler.js';
import { toJson } from '../../lib/serialize.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-17 B.1 Nursery Management: `NurseryManagement.jsx`. The form's `register(...)` names; the options
 * the page's selects offer (they differ a little from `nurseryManagementData.dropdownOptions`, so both
 * are accepted). Beds and stock are added, changed and removed through `/nurseries/:id/beds` and
 * `/nurseries/:id/stock` (RP1-56); recent activities are read from the edit log.
 */
export const NURSERY_TYPES = [
  'Clonal',
  'Seedling',
  'Experimental',
  'Research Nursery',
  'Commercial Nursery',
] as const;
export const IRRIGATION_SOURCES = ['Tube Well', 'Deep Tube Well', 'Canal', 'River', 'Rain Water'] as const;
export const NURSERY_STATUSES = ['Active', 'Inactive', 'Under Maintenance', 'Maintenance'] as const;
export const INSTITUTES = [
  'Tea Research Institute',
  'BTB',
  'Private',
  'Bangladesh Tea Board',
  'Private Nursery',
] as const;

/** A field / block counts as young until it is this many years old (Plantation Summary). */
const YOUNG_YEARS = 5;

const area = () => num().refine((v) => v > 0, 'Area must be greater than 0');

const nurserySchema = z.object({
  estate: ref(),
  division: ref(),
  nurseryName: text(),
  /** The page's fixed supervisor names, until employees exist (C.1). */
  supervisor: text(),
  nurseryCode: text(60),
  nurseryType: oneOf(NURSERY_TYPES),
  location: text(),
  irrigationSource: oneOf(IRRIGATION_SOURCES),
  establishedYear: num()
    .refine((v) => Number.isInteger(v), 'Must be a whole number.')
    .refine((v) => v >= 1900, 'Enter a valid year')
    .refine((v) => v <= new Date().getFullYear(), 'Year cannot be in the future'),
  status: oneOf(NURSERY_STATUSES),
  totalArea: area(),
  netUsableArea: area(),
  active: oneOf(INSTITUTES),
  remarks: longText(),
});

/**
 * The Plantation Summary card (`plantationSummary`, shown on B.1 and B.2) for one estate or all: the fields
 * of A.3, mature vs young by planting year (young = under 5 years), and the nurseries' area.
 */
export async function plantationSummary(estate?: string) {
  const fieldWhere = { deletedAt: null, ...(estate ? { estate } : {}) };
  const youngFrom = new Date().getFullYear() - YOUNG_YEARS + 1;
  const [fields, young, nurseries] = await Promise.all([
    db.fieldBlock.aggregate({ where: fieldWhere, _count: { _all: true }, _sum: { plantedArea: true } }),
    db.fieldBlock.aggregate({
      where: { ...fieldWhere, plantingYear: { gte: youngFrom } },
      _sum: { plantedArea: true },
    }),
    db.nursery.aggregate({ where: fieldWhere, _count: { _all: true }, _sum: { totalArea: true } }),
  ]);
  const planted = Number(fields._sum.plantedArea ?? 0);
  const youngArea = Number(young._sum.plantedArea ?? 0);
  return {
    totalFieldBlock: fields._count._all,
    totalPlantedArea: planted,
    matureArea: Math.round((planted - youngArea) * 100) / 100,
    youngArea,
    nurseryArea: Number(nurseries._sum.totalArea ?? 0),
    totalNursery: nurseries._count._all,
  };
}

export const nurseriesRouter = defineResource('/nurseries', {
  name: 'nursery',
  label: 'Nursery',
  model: 'nursery',
  schema: nurserySchema,
  search: ['nurseryName', 'nurseryCode', 'location', 'supervisor'],
  filters: ['estate', 'division', 'nurseryType', 'status'],
  refs: {
    estate: { model: 'estate', label: 'estateName' },
    division: { model: 'division', label: 'divisionName' },
  },
  unique: [{ field: 'nurseryCode', scope: ['estate'] }],
  orderBy: { nurseryCode: 'asc' },
  check: async (values): Promise<Record<string, string>> => {
    const fields: Record<string, string> = {};
    const division = await db.division.findFirst({
      where: { id: values.division as string },
      select: { estate: true },
    });
    if (division?.estate !== values.estate) fields.division = 'Pick a division of the selected estate.';
    if (Number(values.netUsableArea) > Number(values.totalArea))
      fields.netUsableArea = 'Net usable area cannot be more than the total area.';
    return fields;
  },
  /** The Plantation Summary card for the estate in the filter (or all). */
  summary: (where) => plantationSummary(typeof where.estate === 'string' ? where.estate : undefined),
  options: {
    path: 'nurseries',
    label: (row) => `${String(row.nurseryName)} (${String(row.nurseryCode)})`,
    filters: ['estate', 'division'],
  },
});

/** The right-hand panels of one nursery: summary cards, beds, stock, recent activities. */
export const nurseryPanelsRouter = Router();

async function liveNursery(id: string) {
  const nursery = await db.nursery.findFirst({ where: { id, deletedAt: null } });
  if (!nursery) throw notFound('Nursery');
  return nursery;
}

const stockTotals = (
  rows: {
    totalPlants: number;
    availablePlants: number;
    reservedPlants: number;
    distributedPlants: number;
    distributedThisMonth: number;
  }[],
) => ({
  totalPlants: rows.reduce((s, r) => s + r.totalPlants, 0),
  availablePlants: rows.reduce((s, r) => s + r.availablePlants, 0),
  reservedPlants: rows.reduce((s, r) => s + r.reservedPlants, 0),
  distributedPlants: rows.reduce((s, r) => s + r.distributedPlants, 0),
  distributedThisMonth: rows.reduce((s, r) => s + r.distributedThisMonth, 0),
});

/** `nurserySummary`: the six cards, same titles, units and icons as the data file. */
nurseryPanelsRouter.get('/:id/summary', async (req, res) => {
  const nursery = await liveNursery(req.params.id);
  const [beds, stock] = await Promise.all([
    db.nurseryBed.count({ where: { nurseryId: nursery.id } }),
    db.nurseryStock.findMany({ where: { nurseryId: nursery.id } }),
  ]);
  const t = stockTotals(stock);
  res.json([
    {
      id: 1,
      title: 'Total Area (Acre)',
      value: Number(nursery.totalArea).toFixed(2),
      unit: 'Acre',
      icon: 'Map',
    },
    {
      id: 2,
      title: 'Usable Area (Acre)',
      value: Number(nursery.netUsableArea).toFixed(2),
      unit: 'Acre',
      icon: 'MapPinned',
    },
    { id: 3, title: 'Total Beds / Sections', value: String(beds), unit: '', icon: 'LayoutGrid' },
    { id: 4, title: 'Total Plants', value: String(t.totalPlants), unit: '', icon: 'Sprout' },
    { id: 5, title: 'Available Plants', value: String(t.availablePlants), unit: '', icon: 'Leaf' },
    {
      id: 6,
      title: 'Distributed This Month',
      value: String(t.distributedThisMonth),
      unit: '',
      icon: 'Truck',
    },
  ]);
});

/** `nurseryBeds`: name, code, clone, area, plants, plantingDate, status. */
nurseryPanelsRouter.get('/:id/beds', async (req, res) => {
  const nursery = await liveNursery(req.params.id);
  const beds = await db.nurseryBed.findMany({
    where: { nurseryId: nursery.id },
    orderBy: { position: 'asc' },
  });
  res.json(beds.map(({ nurseryId: _n, position: _p, ...bed }) => toJson(bed)));
});

/** `stockInventory` rows and `stockInventoryTotal`. */
nurseryPanelsRouter.get('/:id/stock', async (req, res) => {
  const nursery = await liveNursery(req.params.id);
  const rows = await db.nurseryStock.findMany({
    where: { nurseryId: nursery.id },
    orderBy: { position: 'asc' },
  });
  const { distributedThisMonth: _m, ...total } = stockTotals(rows);
  res.json({
    stockInventory: rows.map(({ nurseryId: _n, position: _p, distributedThisMonth: _d, ...row }) => row),
    stockInventoryTotal: { label: 'Total', ...total, unit: 'Nos' },
  });
});

// ---------------------------------------------------------------------------------------------
// RP1-56 G.6: add / edit / remove beds and stock rows. Each change is written to the nursery's edit log
// as `{ bed }` or `{ stock }` (before and after), so Recent Activities shows it.
// ---------------------------------------------------------------------------------------------

export const BED_STATUSES = ['Active', 'Inactive', 'Maintenance', 'Under Maintenance'] as const;

const count = () => int('Cannot be negative.');

const bedSchema = z.object({
  name: text(),
  code: text(60),
  clone: text(60),
  area: num().refine((v) => v > 0, 'Area must be greater than 0'),
  plants: count(),
  plantingDate: reqDate(),
  status: oneOf(BED_STATUSES),
});

const stockSchema = z
  .object({
    clone: text(60),
    type: text(60),
    totalPlants: count(),
    availablePlants: count(),
    reservedPlants: count(),
    distributedPlants: count(),
    distributedThisMonth: optInt('Cannot be negative.'),
    unit: text(20).catch('Nos'),
  })
  .superRefine((v, ctx) => {
    if (v.availablePlants + v.reservedPlants + v.distributedPlants > v.totalPlants)
      ctx.addIssue({
        code: 'custom',
        path: ['totalPlants'],
        message: 'Available + reserved + distributed cannot be more than the total.',
      });
    if ((v.distributedThisMonth ?? 0) > v.distributedPlants)
      ctx.addIssue({
        code: 'custom',
        path: ['distributedThisMonth'],
        message: 'Cannot be more than the distributed plants.',
      });
  });

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', zodFields(parsed.error));
  return parsed.data;
}

/** Writes the row change and the nursery's edit-log entry together; the nursery shows who changed it last. */
async function logChange(
  req: Request,
  nurseryId: string,
  key: 'bed' | 'stock',
  before: unknown,
  after: unknown,
  change: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<unknown>,
) {
  const userId = currentUserId(req);
  await db.$transaction(async (tx) => {
    await change(tx);
    await tx.nursery.update({ where: { id: nurseryId }, data: { updatedBy: userId } });
    await writeHistory(tx, {
      resource: 'nursery',
      recordId: nurseryId,
      action: 'update',
      oldData: { [key]: before },
      newData: { [key]: after },
      userId,
    });
  });
}

const bedJson = ({ nurseryId: _n, position: _p, ...bed }: Record<string, unknown>) => toJson(bed);
const stockJson = ({ nurseryId: _n, position: _p, ...row }: Record<string, unknown>) => toJson(row);

async function bedCodeFree(nurseryId: string, code: string, exceptId?: string) {
  const taken = await db.nurseryBed.count({
    where: { nurseryId, code, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (taken)
    throw new AppError('DUPLICATE', 'This record already exists.', {
      code: 'This bed code is already used in this nursery.',
    });
}

async function stockCloneFree(nurseryId: string, clone: string, exceptId?: string) {
  const taken = await db.nurseryStock.count({
    where: { nurseryId, clone, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (taken)
    throw new AppError('DUPLICATE', 'This record already exists.', {
      clone: 'This clone already has a stock row in this nursery.',
    });
}

async function findBed(nurseryId: string, id: string) {
  const bed = await db.nurseryBed.findFirst({ where: { id, nurseryId } });
  if (!bed) throw notFound('Bed');
  return bed;
}

async function findStock(nurseryId: string, id: string) {
  const row = await db.nurseryStock.findFirst({ where: { id, nurseryId } });
  if (!row) throw notFound('Stock row');
  return row;
}

nurseryPanelsRouter.post('/:id/beds', async (req, res) => {
  const nursery = await liveNursery(req.params.id);
  const values = parse(bedSchema, req.body);
  await bedCodeFree(nursery.id, values.code);
  const last = await db.nurseryBed.aggregate({ where: { nurseryId: nursery.id }, _max: { position: true } });
  const id = newId();
  const data = { ...values, id, nurseryId: nursery.id, position: (last._max.position ?? -1) + 1 };
  await logChange(req, nursery.id, 'bed', null, bedJson(data), (tx) => tx.nurseryBed.create({ data }));
  res.status(201).json(bedJson(await findBed(nursery.id, id)));
});

nurseryPanelsRouter.put('/:id/beds/:bedId', async (req, res) => {
  const nursery = await liveNursery(req.params.id);
  const before = await findBed(nursery.id, req.params.bedId);
  const values = parse(bedSchema, req.body);
  await bedCodeFree(nursery.id, values.code, before.id);
  await logChange(req, nursery.id, 'bed', bedJson(before), bedJson({ ...before, ...values }), (tx) =>
    tx.nurseryBed.update({ where: { id: before.id }, data: values }),
  );
  res.json(bedJson(await findBed(nursery.id, before.id)));
});

nurseryPanelsRouter.delete('/:id/beds/:bedId', async (req, res) => {
  const nursery = await liveNursery(req.params.id);
  const before = await findBed(nursery.id, req.params.bedId);
  await logChange(req, nursery.id, 'bed', bedJson(before), null, (tx) =>
    tx.nurseryBed.delete({ where: { id: before.id } }),
  );
  res.status(204).end();
});

nurseryPanelsRouter.post('/:id/stock', async (req, res) => {
  const nursery = await liveNursery(req.params.id);
  const { distributedThisMonth, ...values } = parse(stockSchema, req.body);
  await stockCloneFree(nursery.id, values.clone);
  const last = await db.nurseryStock.aggregate({
    where: { nurseryId: nursery.id },
    _max: { position: true },
  });
  const id = newId();
  const data = {
    ...values,
    distributedThisMonth: distributedThisMonth ?? 0,
    id,
    nurseryId: nursery.id,
    position: (last._max.position ?? -1) + 1,
  };
  await logChange(req, nursery.id, 'stock', null, stockJson(data), (tx) => tx.nurseryStock.create({ data }));
  res.status(201).json(stockJson(await findStock(nursery.id, id)));
});

nurseryPanelsRouter.put('/:id/stock/:stockId', async (req, res) => {
  const nursery = await liveNursery(req.params.id);
  const before = await findStock(nursery.id, req.params.stockId);
  const { distributedThisMonth, ...rest } = parse(stockSchema, req.body);
  // Left empty, "distributed this month" keeps its value.
  const values = { ...rest, distributedThisMonth: distributedThisMonth ?? before.distributedThisMonth };
  if (values.distributedThisMonth > values.distributedPlants)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', {
      distributedThisMonth: 'Cannot be more than the distributed plants.',
    });
  await stockCloneFree(nursery.id, values.clone, before.id);
  await logChange(req, nursery.id, 'stock', stockJson(before), stockJson({ ...before, ...values }), (tx) =>
    tx.nurseryStock.update({ where: { id: before.id }, data: values }),
  );
  res.json(stockJson(await findStock(nursery.id, before.id)));
});

nurseryPanelsRouter.delete('/:id/stock/:stockId', async (req, res) => {
  const nursery = await liveNursery(req.params.id);
  const before = await findStock(nursery.id, req.params.stockId);
  await logChange(req, nursery.id, 'stock', stockJson(before), null, (tx) =>
    tx.nurseryStock.delete({ where: { id: before.id } }),
  );
  res.status(204).end();
});

/** One line for a bed / stock change in the edit log, or null for a change to the nursery itself. */
function rowActivity(before: Record<string, unknown>, after: Record<string, unknown>, by: string) {
  for (const [key, label] of [
    ['bed', 'Bed'],
    ['stock', 'Stock'],
  ] as const) {
    if (!(key in after) && !(key in before)) continue;
    const old = before[key] as Record<string, unknown> | null | undefined;
    const now = after[key] as Record<string, unknown> | null | undefined;
    const row = now ?? old ?? {};
    const name = key === 'bed' ? `${String(row.name)} (${String(row.code)})` : String(row.clone);
    const verb = !old ? 'added' : !now ? 'removed' : 'updated';
    return `${label} ${name} ${verb} by ${by}`;
  }
  return null;
}

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** `recentActivities`: the nursery's edit log, newest first, as one line each. */
nurseryPanelsRouter.get('/:id/activities', async (req, res) => {
  const nursery = await liveNursery(req.params.id);
  const log = await readHistory('nursery', nursery.id);
  res.json(
    log.slice(0, 10).map((entry, i) => {
      let activity = `Nursery ${nursery.nurseryName} ${entry.action}d by ${entry.changedBy.name}`;
      if (entry.action === 'update') {
        const before = (entry.oldData ?? {}) as Record<string, unknown>;
        const after = (entry.newData ?? {}) as Record<string, unknown>;
        const row = rowActivity(before, after, entry.changedBy.name);
        if (row) return { id: i + 1, activity: row, date: ddmmyyyy(entry.changedAt) };
        const changed = Object.keys(after).filter(
          (k) => k in before && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
        );
        activity = changed.length
          ? `${changed.join(', ')} updated by ${entry.changedBy.name}`
          : `Nursery saved by ${entry.changedBy.name}`;
      }
      return { id: i + 1, activity, date: ddmmyyyy(entry.changedAt) };
    }),
  );
});

const panel = (summary: string, description: string) => ({
  get: {
    tags: ['Nursery'],
    summary,
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { '200': { description }, '404': { description: 'Nursery not found' } },
  },
});
docsPaths['/nurseries/{id}/summary'] = panel('Nursery Summary cards', 'The six nurserySummary cards');
const rowOp = (method: 'post' | 'put' | 'delete', summary: string, sub: string, schemaName: string) => ({
  [method]: {
    tags: ['Nursery'],
    summary,
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ...(method === 'post' ? [] : [{ name: sub, in: 'path', required: true, schema: { type: 'string' } }]),
    ],
    ...(method === 'delete'
      ? {}
      : { requestBody: { content: { 'application/json': { schema: { description: schemaName } } } } }),
    responses: {
      [method === 'post' ? '201' : method === 'put' ? '200' : '204']: {
        description: 'Saved; logged on the nursery',
      },
      '400': { description: 'Validation error' },
      '404': { description: 'Nursery or row not found' },
      '409': { description: 'Duplicate bed code / stock clone in this nursery' },
    },
  },
});
const BED_BODY = '{ name, code, clone, area, plants, plantingDate, status }';
const STOCK_BODY =
  '{ clone, type, totalPlants, availablePlants, reservedPlants, distributedPlants, distributedThisMonth?, unit }';
docsPaths['/nurseries/{id}/beds'] = {
  ...panel('Nursery beds', `[{ id, name, code, clone, area, plants, plantingDate, status }]`),
  ...rowOp('post', 'Add a bed', 'bedId', BED_BODY),
};
docsPaths['/nurseries/{id}/beds/{bedId}'] = {
  ...rowOp('put', 'Edit a bed', 'bedId', BED_BODY),
  ...rowOp('delete', 'Remove a bed', 'bedId', ''),
};
docsPaths['/nurseries/{id}/stock'] = {
  ...panel('Stock inventory', '{ stockInventory: [...], stockInventoryTotal: {...} }'),
  ...rowOp('post', 'Add a stock row', 'stockId', STOCK_BODY),
};
docsPaths['/nurseries/{id}/stock/{stockId}'] = {
  ...rowOp('put', 'Edit a stock row', 'stockId', STOCK_BODY),
  ...rowOp('delete', 'Remove a stock row', 'stockId', ''),
};
docsPaths['/nurseries/{id}/activities'] = panel(
  'Recent activities (from the edit log)',
  '[{ id, activity, date }]',
);
