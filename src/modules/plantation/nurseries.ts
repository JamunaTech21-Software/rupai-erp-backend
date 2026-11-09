import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { pendingBadges, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { int, longText, num, oneOf, optInt, ref, reqDate, text } from '../../lib/fields.js';
import { readHistory } from '../../lib/history.js';
import { defineResource } from '../../lib/resource.js';
import { toJson } from '../../lib/serialize.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-17 B.1 Nursery Management: `NurseryManagement.jsx`. The form's `register(...)` names; the options
 * the page's selects offer (they differ a little from `nurseryManagementData.dropdownOptions`, so both
 * are accepted). Recent activities are read from the edit log.
 *
 * RP1-127 M.2: one save of the form is one approval request. `POST` takes `beds` and `stock`; `PUT` takes the
 * nursery fields with `bedChanges` and `stockChanges`. RP1-134 removed the bed and stock write endpoints of
 * RP1-56; `GET /nurseries/:id/beds` and `/stock` stay for reading.
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

export const nurseriesRouter = defineResource('/nurseries', {
  name: 'nursery',
  label: 'Nursery',
  module: 'plantation',
  page: 'Nursery Management',
  describe: (r) => show(r.nurseryName, `(${String(r.nurseryCode)})`),
  model: 'nursery',
  schema: nurserySchema,
  search: ['nurseryName', 'nurseryCode', 'location', 'supervisor'],
  filters: ['estate', 'division', 'nurseryType', 'status'],
  refs: {
    estate: { model: 'estate', label: 'estateName' },
    division: { model: 'division', label: 'divisionName' },
  },
  unique: [{ field: 'nurseryCode', scope: ['estate'] }],
  children: [
    {
      key: 'beds',
      model: 'nurseryBed',
      parentKey: 'nurseryId',
      schema: bedSchema,
      createOnly: true,
      badge: 'nurseryBed',
      changes: {
        key: 'bedChanges',
        history: 'bed',
        noun: 'bed',
        unique: { field: 'code', message: 'This bed code is already used in this nursery.' },
      },
    },
    {
      key: 'stock',
      model: 'nurseryStock',
      parentKey: 'nurseryId',
      schema: stockSchema,
      // Left empty, "distributed this month" keeps its value (0 for a new row).
      compute: (row, before) => ({
        ...row,
        distributedThisMonth: row.distributedThisMonth ?? before?.distributedThisMonth ?? 0,
      }),
      createOnly: true,
      badge: 'nurseryStock',
      changes: {
        key: 'stockChanges',
        history: 'stock',
        noun: 'stock row',
        unique: { field: 'clone', message: 'This clone already has a stock row in this nursery.' },
        check: (row): Record<string, string> =>
          Number(row.distributedThisMonth) > Number(row.distributedPlants)
            ? { distributedThisMonth: 'Cannot be more than the distributed plants.' }
            : {},
      },
    },
  ],
  orderBy: { nurseryCode: 'asc' },
  /** RP1-81 J.4 Nursery List: each nursery's bed count and stock. */
  enrich: async (rows) => {
    const where = { nurseryId: { in: rows.map((r) => r.id) } };
    const [beds, stock] = await Promise.all([
      db.nurseryBed.groupBy({ by: ['nurseryId'], where, _count: { _all: true }, _sum: { plants: true } }),
      db.nurseryStock.groupBy({
        by: ['nurseryId'],
        where,
        _sum: { totalPlants: true, availablePlants: true },
      }),
    ]);
    const bed = new Map(beds.map((g) => [g.nurseryId, g]));
    const st = new Map(stock.map((g) => [g.nurseryId, g]));
    return new Map(
      rows.map((r) => [
        r.id,
        {
          bedCount: bed.get(r.id)?._count._all ?? 0,
          plantsInBeds: bed.get(r.id)?._sum.plants ?? 0,
          totalStock: st.get(r.id)?._sum.totalPlants ?? 0,
          availableStock: st.get(r.id)?._sum.availablePlants ?? 0,
        },
      ]),
    );
  },
  export: {
    fileName: 'nurseries',
    sheet: 'Nurseries',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Nursery Code', value: (row) => row.nurseryCode, width: 14 },
      { header: 'Nursery Name', value: (row) => row.nurseryName, width: 26 },
      { header: 'Estate', value: (row) => row.estateName, width: 24 },
      { header: 'Division', value: (row) => row.divisionName, width: 18 },
      { header: 'Beds', value: (row) => row.bedCount, width: 8 },
      { header: 'Total Stock', value: (row) => row.totalStock, width: 12 },
      { header: 'Available Stock', value: (row) => row.availableStock, width: 15 },
      { header: 'Status', value: (row) => row.status, width: 12 },
    ],
  },
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
  const badges = await pendingBadges(
    'nurseryBed',
    beds.map((b) => b.id),
  );
  res.json(
    beds.map(({ nurseryId: _n, position: _p, ...bed }) => ({
      ...(toJson(bed) as object),
      pendingRequest: badges.get(bed.id) ?? null,
    })),
  );
});

/** `stockInventory` rows and `stockInventoryTotal`. */
nurseryPanelsRouter.get('/:id/stock', async (req, res) => {
  const nursery = await liveNursery(req.params.id);
  const rows = await db.nurseryStock.findMany({
    where: { nurseryId: nursery.id },
    orderBy: { position: 'asc' },
  });
  const { distributedThisMonth: _m, ...total } = stockTotals(rows);
  const stockBadges = await pendingBadges(
    'nurseryStock',
    rows.map((r) => r.id),
  );
  res.json({
    stockInventory: rows.map(({ nurseryId: _n, position: _p, distributedThisMonth: _d, ...row }) => ({
      ...row,
      pendingRequest: stockBadges.get(row.id) ?? null,
    })),
    stockInventoryTotal: { label: 'Total', ...total, unit: 'Nos' },
  });
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
docsPaths['/nurseries/{id}/beds'] = panel(
  'Nursery beds',
  `[{ id, name, code, clone, area, plants, plantingDate, status }]`,
);
docsPaths['/nurseries/{id}/stock'] = panel(
  'Stock inventory',
  '{ stockInventory: [...], stockInventoryTotal: {...} }',
);
docsPaths['/nurseries/{id}/activities'] = panel(
  'Recent activities (from the edit log)',
  '[{ id, activity, date }]',
);
