import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { int, list, longText, num, optInt, optNum, option, ref, reqDate, text } from '../../lib/fields.js';
import { readHistory } from '../../lib/history.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { checkLocation } from '../estate/location.js';

/**
 * RP1-20 B.4 Plant Census: `PlantCensus.jsx`. The form's `register(...)` names with the page's own messages,
 * plus the row-wise table (`rowWiseTable.headers` keys) as `rows`, and photos / documents as file ids.
 * The cards, charts and census history come from `GET /plant-censuses/{id}/report`.
 */
const year = (required: string) =>
  num()
    .refine((v) => Number.isInteger(v), 'Must be a whole number.')
    .refine((v) => v >= 1900 && v <= 2100, required);
const ROW_MESSAGE = 'Row number must be greater than 0.';
const rowNumber = () => int(ROW_MESSAGE).refine((v) => v >= 1, ROW_MESSAGE);

const censusSchema = z.object({
  estate: ref(),
  division: ref(),
  section: ref(),
  fieldBlock: ref(),
  censusDate: reqDate(),
  censusYear: year('Please enter census year.'),
  surveyType: option(),
  rowFrom: rowNumber(),
  rowTo: rowNumber(),
  /** Read-only on the page: rowTo − rowFrom + 1 (checked when sent). */
  totalSelectedRows: optInt(),
  rowSpacing: num(),
  plantingYear: year('Planting year is required.'),
  cloneVariety: option(),
  elevation: optNum(),
  plantSpacing: num(),
  censusBy: text(),
  supervisor: option(),
  censusMethod: option(),
  remarks: longText(),
  photos: list(),
  documents: list(),
});

const rowSchema = z.object({
  rowNo: text(20),
  rowLength: num(),
  plantsPerMeter: num(),
  expectedPlants: int(),
  livePlants: int(),
  deadPlants: int(),
  missingPlants: int(),
});

const round2 = (n: number) => Math.round(n * 100) / 100;
const gap = (r: { expectedPlants: unknown; deadPlants: unknown; missingPlants: unknown }) =>
  Number(r.expectedPlants)
    ? round2(((Number(r.deadPlants) + Number(r.missingPlants)) / Number(r.expectedPlants)) * 100)
    : 0;

export const censusesRouter = defineResource('/plant-censuses', {
  name: 'plantCensus',
  label: 'Plant census',
  model: 'plantCensus',
  schema: censusSchema,
  search: ['censusBy', 'cloneVariety', 'remarks'],
  filters: [
    'estate',
    'division',
    'section',
    'fieldBlock',
    'surveyType',
    'censusMethod',
    { name: 'censusYear', where: (v) => ({ censusYear: Number.parseInt(v, 10) || 0 }) },
  ],
  refs: {
    estate: { model: 'estate', label: 'estateName' },
    division: { model: 'division', label: 'divisionName' },
    section: { model: 'section', label: 'sectionName' },
    fieldBlock: { model: 'fieldBlock', label: 'fieldCode' },
  },
  files: ['photos', 'documents'],
  children: [
    {
      key: 'rows',
      model: 'plantCensusRow',
      parentKey: 'censusId',
      schema: rowSchema,
      compute: (row) => ({ ...row, gapPercentage: gap(row as Parameters<typeof gap>[0]) }),
    },
  ],
  orderBy: [{ censusDate: 'desc' }],
  onSave: (values) => ({ totalSelectedRows: Number(values.rowTo) - Number(values.rowFrom) + 1 }),
  check: async (values): Promise<Record<string, string>> => {
    const fields = await checkLocation(values);
    const rows = Number(values.rowTo) - Number(values.rowFrom) + 1;
    if (rows < 1) fields.rowTo = 'Ending row cannot be before the starting row.';
    else if (values.totalSelectedRows !== null && Number(values.totalSelectedRows) !== rows)
      fields.totalSelectedRows = `Total selected rows is ${rows} (rowTo − rowFrom + 1).`;
    if (values.censusDate instanceof Date && values.censusDate.getUTCFullYear() !== Number(values.censusYear))
      fields.censusYear = 'Census year must match the census date.';
    return fields;
  },
  /** Census totals over the censuses in the filter (their rows). */
  summary: async (where) => {
    const censuses = await db.plantCensus.findMany({ where, select: { id: true } });
    const totals = await db.plantCensusRow.aggregate({
      where: { censusId: { in: censuses.map((c) => c.id) } },
      _count: { _all: true },
      _sum: { expectedPlants: true, livePlants: true, deadPlants: true, missingPlants: true },
    });
    const expected = Number(totals._sum.expectedPlants ?? 0);
    return {
      totalCensuses: censuses.length,
      totalRows: totals._count._all,
      expectedPlants: expected,
      livePlants: Number(totals._sum.livePlants ?? 0),
      deadPlants: Number(totals._sum.deadPlants ?? 0),
      missingPlants: Number(totals._sum.missingPlants ?? 0),
      survivalRate: expected ? round2((Number(totals._sum.livePlants ?? 0) / expected) * 100) : 0,
    };
  },
});

/**
 * One census's cards and charts, shaped like the data file: `censusSummary`, `summaryCards`, `charts`
 * (liveVsDeadChart, plantDistributionChart, survivalRateChart, censusProgress) and `censusHistory` (edit log).
 */
export const censusReportRouter = Router();

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const ACTIONS: Record<string, string> = {
  create: 'Census Created',
  update: 'Data Entry',
  delete: 'Census Deleted',
  restore: 'Census Restored',
};

censusReportRouter.get('/:id/report', async (req, res) => {
  const census = await db.plantCensus.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!census) throw notFound('Plant census');
  const [rows, field, log] = await Promise.all([
    db.plantCensusRow.findMany({ where: { censusId: census.id }, orderBy: { position: 'asc' } }),
    db.fieldBlock.findUnique({
      where: { id: census.fieldBlock },
      select: { totalArea: true, plantedArea: true },
    }),
    readHistory('plantCensus', census.id),
  ]);
  const total = (key: 'expectedPlants' | 'livePlants' | 'deadPlants' | 'missingPlants') =>
    rows.reduce((s, r) => s + r[key], 0);
  const expected = total('expectedPlants');
  const live = total('livePlants');
  const dead = total('deadPlants');
  const missing = total('missingPlants');
  const area = Number(field?.plantedArea ?? field?.totalArea ?? 0);
  const totalLength = rows.reduce((s, r) => s + Number(r.rowLength), 0);
  const plantsPerMeter = totalLength ? round2(live / totalLength) : 0;
  const gapPercentage = expected ? round2(((dead + missing) / expected) * 100) : 0;
  const completedRows = rows.length;
  const status =
    completedRows >= census.totalSelectedRows ? 'Completed' : completedRows ? 'In Progress' : 'Pending';
  const pct = (n: number) => (expected ? round2((n / expected) * 100) : 0);

  res.json({
    censusSummary: {
      totalArea: area,
      totalRows: census.totalSelectedRows,
      expectedPlants: expected,
      livePlants: live,
      deadPlants: dead,
      missingPlants: missing,
      gapPercentage,
      dataEntryStatus: status,
    },
    summaryCards: {
      totalArea: area,
      expectedPlants: expected,
      livePlants: live,
      deadPlants: dead,
      missingPlants: missing,
      avgPlantsPerAcre: area ? Math.round(live / area) : 0,
      plantsPerMeter,
    },
    charts: {
      liveVsDeadChart: {
        title: 'Live vs Dead Plants',
        total: expected,
        data: [
          { id: 1, name: 'Live Plants', value: live, percentage: pct(live), color: '#15803D' },
          { id: 2, name: 'Dead Plants', value: dead, percentage: pct(dead), color: '#EF4444' },
        ],
      },
      plantDistributionChart: {
        title: 'Plant Distribution (Row Wise)',
        data: rows.map((r) => ({
          row: r.rowNo,
          livePlants: r.livePlants,
          deadPlants: r.deadPlants,
          gap: Number(r.gapPercentage),
        })),
      },
      survivalRateChart: rows.map((r) => ({
        row: r.rowNo,
        survival: r.expectedPlants ? round2((r.livePlants / r.expectedPlants) * 100) : 0,
      })),
      censusProgress: {
        completedRows,
        totalRows: census.totalSelectedRows,
        completedPercentage: census.totalSelectedRows
          ? Math.min(100, Math.round((completedRows / census.totalSelectedRows) * 100))
          : 0,
        pendingRows: Math.max(0, census.totalSelectedRows - completedRows),
      },
    },
    censusHistory: log.map((entry, i) => ({
      id: i + 1,
      censusDate: ddmmyyyy(entry.changedAt),
      action: ACTIONS[entry.action] ?? entry.action,
      user: entry.changedBy.name,
      remarks: entry.action === 'update' ? 'Census data updated' : '',
    })),
  });
});

docsPaths['/plant-censuses/{id}/report'] = {
  get: {
    tags: ['Plant census'],
    summary: 'Cards, charts and history of one census, shaped like plantCensusData.js',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': { description: '{ censusSummary, summaryCards, charts, censusHistory }' },
      '404': { description: 'Not found' },
    },
  },
};
