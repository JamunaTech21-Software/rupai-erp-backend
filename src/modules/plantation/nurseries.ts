import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { longText, num, oneOf, ref, text } from '../../lib/fields.js';
import { readHistory } from '../../lib/history.js';
import { defineResource } from '../../lib/resource.js';
import { toJson } from '../../lib/serialize.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-17 B.1 Nursery Management: `NurseryManagement.jsx`. The form's `register(...)` names; the options
 * the page's selects offer (they differ a little from `nurseryManagementData.dropdownOptions`, so both
 * are accepted). Beds, stock and recent activities have no form: read-only.
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
  'Nursery beds (read-only)',
  '[{ id, name, code, clone, area, plants, plantingDate, status }]',
);
docsPaths['/nurseries/{id}/stock'] = panel(
  'Stock inventory (read-only)',
  '{ stockInventory: [...], stockInventoryTotal: {...} }',
);
docsPaths['/nurseries/{id}/activities'] = panel(
  'Recent activities (from the edit log)',
  '[{ id, activity, date }]',
);
