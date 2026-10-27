import { type Request, Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { int, longText, num, optNum, option, ref, reqDate, text } from '../../lib/fields.js';
import { centre, isPolygon } from '../../lib/geo.js';
import { writeHistory } from '../../lib/history.js';
import { newId } from '../../lib/ids.js';
import { currentUserId, defineResource } from '../../lib/resource.js';
import { toJson } from '../../lib/serialize.js';
import { z } from '../../lib/validation.js';
import { zodFields } from '../../middleware/error-handler.js';
import { checkLocation } from '../estate/location.js';

/**
 * RP1-21 B.5 Bush Register: `BushRegister.jsx`. The form's `register(...)` names with the page's messages
 * (its "Search" is the list's filters). The row table (`bushRegisterList`) has its own paged endpoints, for
 * "Add Manual Entry" and the edit / delete buttons on each row. The panels come from `GET /{id}/report`.
 */
const registerSchema = z.object({
  estate: ref(),
  division: ref(),
  section: ref(),
  fieldBlock: ref(),
  plantingYear: int().refine((v) => v >= 1900 && v <= 2100, 'Planting Year is required'),
  bushAge: int(),
  totalArea: num(),
  rowSpacing: num(),
  plantSpacing: num(),
  surveyDate: reqDate(),
  surveyor: text(),
  bushStatus: option(),
  bushHealth: option(),
  productionZone: option(),
  rowDirection: option(),
});

const HEALTH = ['Excellent', 'Good', 'Fair', 'Poor', 'Dead'] as const;
const health = z.preprocess(
  (v) =>
    typeof v === 'string' && v.trim()
      ? v.trim().charAt(0).toUpperCase() + v.trim().slice(1).toLowerCase()
      : null,
  z.enum(HEALTH, { error: `Choose one of: ${HEALTH.join(', ')}.` }).nullable(),
);

const rowSchema = z.object({
  rowNo: text(20),
  from: int(),
  to: int(),
  totalBush: int(),
  productive: int(),
  dead: int(),
  missing: int(),
  height: optNum(),
  spread: optNum(),
  health,
  remarks: longText(),
});

const round2 = (n: number) => Math.round(n * 100) / 100;
const gapOf = (r: { totalBush: number; dead: number; missing: number }) =>
  r.totalBush ? round2(((r.dead + r.missing) / r.totalBush) * 100) : 0;

export const bushRegisterRouter = defineResource('/bush-registers', {
  name: 'bushRegister',
  label: 'Bush register',
  model: 'bushRegister',
  schema: registerSchema,
  search: ['surveyor', 'productionZone'],
  filters: [
    'estate',
    'division',
    'section',
    'fieldBlock',
    'bushStatus',
    'bushHealth',
    'productionZone',
    'rowDirection',
    'surveyor',
    { name: 'plantingYear', where: (v) => ({ plantingYear: Number.parseInt(v, 10) || 0 }) },
  ],
  refs: {
    estate: { model: 'estate', label: 'estateName' },
    division: { model: 'division', label: 'divisionName' },
    section: { model: 'section', label: 'sectionName' },
    fieldBlock: { model: 'fieldBlock', label: 'fieldCode' },
  },
  orderBy: [{ surveyDate: 'desc' }],
  check: async (values) => checkLocation(values),
  /** Bush totals over the registers in the filter. */
  summary: async (where) => {
    const registers = await db.bushRegister.findMany({ where, select: { id: true, totalArea: true } });
    const totals = await db.bushRegisterRow.aggregate({
      where: { registerId: { in: registers.map((r) => r.id) } },
      _count: { _all: true },
      _sum: { totalBush: true, productive: true, dead: true, missing: true },
    });
    const totalBush = totals._sum.totalBush ?? 0;
    const dead = totals._sum.dead ?? 0;
    const missing = totals._sum.missing ?? 0;
    return {
      totalRegisters: registers.length,
      totalArea: round2(registers.reduce((s, r) => s + Number(r.totalArea), 0)),
      totalRows: totals._count._all,
      totalBush,
      productive: totals._sum.productive ?? 0,
      dead,
      missing,
      gap: totalBush ? round2(((dead + missing) / totalBush) * 100) : 0,
    };
  },
});

// ---- Row table ---------------------------------------------------------------------------------------------

export const bushRowsRouter = Router();

const Paging = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  perPage: z.coerce.number().int().min(1).max(100).catch(10),
});

const liveRegister = async (id: string) => {
  const register = await db.bushRegister.findFirst({ where: { id, deletedAt: null } });
  if (!register) throw notFound('Bush register');
  return register;
};

type RowRecord = Awaited<ReturnType<typeof db.bushRegisterRow.findMany>>[number];

/** Total line under the table: sums, average height / spread, and the most common health (by bushes). */
function tableSummary(rows: RowRecord[]) {
  const sum = (k: 'totalBush' | 'productive' | 'dead' | 'missing') => rows.reduce((s, r) => s + r[k], 0);
  const avg = (k: 'height' | 'spread') => {
    const given = rows.filter((r) => r[k] !== null);
    return given.length ? round2(given.reduce((s, r) => s + Number(r[k]), 0) / given.length) : 0;
  };
  const byHealth = new Map<string, number>();
  for (const r of rows) if (r.health) byHealth.set(r.health, (byHealth.get(r.health) ?? 0) + r.totalBush);
  const totalBush = sum('totalBush');
  return {
    totalBush,
    productive: sum('productive'),
    dead: sum('dead'),
    missing: sum('missing'),
    gap: totalBush ? round2(((sum('dead') + sum('missing')) / totalBush) * 100) : 0,
    height: avg('height'),
    spread: avg('spread'),
    health: [...byHealth.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  };
}

/** Checks one row and works out its gap; every mistake comes back in one answer. */
async function parseRow(registerId: string, body: unknown, rowId?: string) {
  const parsed = rowSchema.safeParse(body ?? {});
  const invalid: Record<string, string> = parsed.success ? {} : zodFields(parsed.error);
  if (parsed.success) {
    const r = parsed.data;
    if (r.from < 1) invalid.from = 'Must be 1 or more.';
    if (r.to < r.from) invalid.to = 'Must not be less than From.';
    if (r.productive + r.dead + r.missing > r.totalBush)
      invalid.totalBush = 'Productive, dead and missing bushes cannot be more than the total.';
    const clash = await db.bushRegisterRow.findFirst({
      where: { registerId, rowNo: r.rowNo, ...(rowId ? { id: { not: rowId } } : {}) },
    });
    if (clash) invalid.rowNo = 'This row is already in the register.';
  }
  if (!parsed.success || Object.keys(invalid).length)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', invalid);
  return { ...parsed.data, gap: gapOf(parsed.data) };
}

const rowHistory = (req: Request<{ id: string }>, oldRow: unknown, newRow: unknown) => ({
  resource: 'bushRegister',
  recordId: req.params.id,
  action: 'update' as const,
  oldData: oldRow ? { row: toJson(oldRow) } : undefined,
  newData: newRow ? { row: toJson(newRow) } : undefined,
  userId: currentUserId(req),
});

bushRowsRouter.get('/:id/rows', async (req, res) => {
  const register = await liveRegister(req.params.id);
  const { page, perPage } = Paging.parse(req.query);
  const all = await db.bushRegisterRow.findMany({
    where: { registerId: register.id },
    orderBy: [{ from: 'asc' }, { rowNo: 'asc' }],
  });
  res.json({
    data: toJson(all.slice((page - 1) * perPage, page * perPage)),
    meta: { page, perPage, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / perPage)) },
    tableSummary: tableSummary(all),
  });
});

bushRowsRouter.post('/:id/rows', async (req, res) => {
  const register = await liveRegister(req.params.id);
  const data = await parseRow(register.id, req.body);
  const id = newId();
  await db.$transaction(async (tx) => {
    await tx.bushRegisterRow.create({ data: { ...data, id, registerId: register.id } });
    await tx.bushRegister.update({ where: { id: register.id }, data: { updatedBy: currentUserId(req) } });
    await writeHistory(tx, rowHistory(req, null, { id, ...data }));
  });
  res.status(201).json(toJson(await db.bushRegisterRow.findUnique({ where: { id } })));
});

bushRowsRouter.put('/:id/rows/:rowId', async (req, res) => {
  const register = await liveRegister(req.params.id);
  const before = await db.bushRegisterRow.findFirst({
    where: { id: req.params.rowId, registerId: register.id },
  });
  if (!before) throw notFound('Row');
  const data = await parseRow(register.id, req.body, before.id);
  await db.$transaction(async (tx) => {
    await tx.bushRegisterRow.update({ where: { id: before.id }, data });
    await tx.bushRegister.update({ where: { id: register.id }, data: { updatedBy: currentUserId(req) } });
    await writeHistory(tx, rowHistory(req, before, { id: before.id, ...data }));
  });
  res.json(toJson(await db.bushRegisterRow.findUnique({ where: { id: before.id } })));
});

bushRowsRouter.delete('/:id/rows/:rowId', async (req, res) => {
  const register = await liveRegister(req.params.id);
  const before = await db.bushRegisterRow.findFirst({
    where: { id: req.params.rowId, registerId: register.id },
  });
  if (!before) throw notFound('Row');
  await db.$transaction(async (tx) => {
    await tx.bushRegisterRow.delete({ where: { id: before.id } });
    await tx.bushRegister.update({ where: { id: register.id }, data: { updatedBy: currentUserId(req) } });
    await writeHistory(tx, rowHistory(req, before, null));
  });
  res.status(204).end();
});

// ---- Report: the panels around the table --------------------------------------------------------------------

const AGE_BANDS = [
  { id: 1, age: '1 - 2 Year', min: 0, max: 2, color: '#0b7a29' },
  { id: 2, age: '3 - 5 Year', min: 3, max: 5, color: '#74bf45' },
  { id: 3, age: '6 - 10 Year', min: 6, max: 10, color: '#f3b400' },
  { id: 4, age: '10+ Year', min: 11, max: Number.POSITIVE_INFINITY, color: '#db3d30' },
];
const HEALTH_COLOURS: Record<(typeof HEALTH)[number], string> = {
  Excellent: '#0f8a28',
  Good: '#4caf50',
  Fair: '#f4b400',
  Poor: '#ff9800',
  Dead: '#f44336',
};
const LEGENDS = [
  { id: 1, title: 'High Density', color: '#0f8a28' },
  { id: 2, title: 'Good Density', color: '#69c33d' },
  { id: 3, title: 'Low Density', color: '#f2c300' },
  { id: 4, title: 'Very Low Density', color: '#e53935' },
  { id: 5, title: 'Road', color: '#8d8d8d' },
];
const label = (v: string) => v.charAt(0).toUpperCase() + v.slice(1).replace(/-/g, ' ');

bushRowsRouter.get('/:id/report', async (req, res) => {
  const register = await liveRegister(req.params.id);
  const [rows, field, planting, estateFields] = await Promise.all([
    db.bushRegisterRow.findMany({ where: { registerId: register.id } }),
    db.fieldBlock.findUnique({ where: { id: register.fieldBlock } }),
    db.fieldPlanting.findFirst({
      where: { fieldBlock: register.fieldBlock, deletedAt: null },
      orderBy: { plantingDate: 'desc' },
      select: { cloneVariety: true },
    }),
    db.fieldBlock.findMany({
      where: { estate: register.estate, deletedAt: null },
      select: { plantingYear: true, plantedArea: true },
    }),
  ]);
  const totals = tableSummary(rows);
  const area = Number(register.totalArea);
  const totalGap = totals.dead + totals.missing;
  const density = area ? Math.round(totals.totalBush / area) : 0;
  const card = (id: number, title: string, value: unknown, icon: string, unit = '') => ({
    id,
    title,
    value,
    unit,
    icon,
  });

  // Age profile of the estate's planted area, by the age of each field (survey year − planting year).
  const surveyYear = register.surveyDate.getUTCFullYear();
  const plantedTotal = estateFields.reduce((s, f) => s + Number(f.plantedArea), 0);
  const bushAgeProfile = AGE_BANDS.map(({ id, age, min, max, color }) => {
    const bandArea = round2(
      estateFields
        .filter((f) => surveyYear - f.plantingYear >= min && surveyYear - f.plantingYear <= max)
        .reduce((s, f) => s + Number(f.plantedArea), 0),
    );
    return {
      id,
      age,
      area: bandArea,
      percentage: plantedTotal ? round2((bandArea / plantedTotal) * 100) : 0,
      color,
    };
  });

  const sizes = [
    { id: 1, size: 'Small (1-2 Plants)', count: register.smallGaps },
    { id: 2, size: 'Medium (3-5 Plants)', count: register.mediumGaps },
    { id: 3, size: 'Large (6+ Plants)', count: register.largeGaps },
  ];
  const gapCount = sizes.reduce((s, g) => s + (g.count ?? 0), 0);
  const healthBushes = rows.reduce((s, r) => s + (r.health ? r.totalBush : 0), 0);
  const gapPct = totals.gap;
  const points = field && isPolygon(field.polygon) ? field.polygon : null;
  const [latitude, longitude] = points ? centre(points) : [null, null];

  res.json({
    summary: [
      card(1, 'Total Area (Acre)', area, 'Map'),
      card(2, 'Total Rows', rows.length, 'Rows'),
      card(3, 'Total Bushes', totals.totalBush, 'Trees'),
      card(4, 'Productive Bushes', totals.productive, 'Leaf'),
      card(5, 'Dead Bushes', totals.dead, 'TreePine'),
      card(6, 'Missing Bushes', totals.missing, 'CircleOff'),
      card(7, 'Gap Percentage', gapPct, 'Gauge', '%'),
      card(8, 'Avg. Bush Height', totals.height, 'ArrowUp', 'cm'),
      card(9, 'Avg. Bush Spread', totals.spread, 'GitBranch', 'cm'),
      card(10, 'Bush Density / Acre', density, 'Grid2x2'),
      card(11, 'Bush Health', label(register.bushHealth), 'ShieldCheck'),
      card(12, 'Repl. Requirement', totalGap, 'Sprout', 'Bushes'),
    ],
    map: {
      blockName: field?.fieldCode ?? null,
      area,
      latitude,
      longitude,
      polygon: points,
      legends: LEGENDS,
    },
    bushAgeProfile,
    gapSummary: {
      totalGap,
      gapArea: density ? round2(totalGap / density) : 0,
      replantRequired: totalGap,
      suggestedAction: totalGap === 0 ? 'No action needed' : gapPct >= 5 ? 'Replanting' : 'Gap Filling',
      recommendedClone: planting?.cloneVariety ?? null,
      bestTime: 'Monsoon (Jun - Jul)',
    },
    gapSizeDetails: sizes.map((g) => ({
      id: g.id,
      size: g.size,
      count: g.count ?? 0,
      percentage: gapCount ? round2(((g.count ?? 0) / gapCount) * 100) : 0,
      replant: g.count ?? 0,
    })),
    healthDistribution: HEALTH.map((name, i) => ({
      id: i + 1,
      name,
      percentage: healthBushes
        ? round2(
            (rows.filter((r) => r.health === name).reduce((s, r) => s + r.totalBush, 0) / healthBushes) * 100,
          )
        : 0,
      color: HEALTH_COLOURS[name],
    })),
    tableSummary: totals,
  });
});

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
const rowParam = { name: 'rowId', in: 'path', required: true, schema: { type: 'string' } };
const tags = ['Bush register'];
docsPaths['/bush-registers/{id}/rows'] = {
  get: {
    tags,
    summary: 'The row table, paged (?page, ?perPage), with tableSummary over all rows',
    parameters: [idParam],
    responses: {
      '200': { description: '{ data, meta, tableSummary }' },
      '404': { description: 'Not found' },
    },
  },
  post: {
    tags,
    summary: 'Add a row (Add Manual Entry). gap is worked out by the server.',
    parameters: [idParam],
    responses: { '201': { description: 'The row' }, '400': { description: 'error.fields' } },
  },
};
docsPaths['/bush-registers/{id}/rows/{rowId}'] = {
  put: {
    tags,
    summary: 'Change a row',
    parameters: [idParam, rowParam],
    responses: { '200': { description: 'The row' }, '400': { description: 'error.fields' } },
  },
  delete: {
    tags,
    summary: 'Remove a row',
    parameters: [idParam, rowParam],
    responses: { '204': { description: 'Removed' }, '404': { description: 'Not found' } },
  },
};
docsPaths['/bush-registers/{id}/report'] = {
  get: {
    tags,
    summary: 'The panels, shaped like bushRegisterData.js',
    parameters: [idParam],
    responses: {
      '200': {
        description:
          '{ summary, map, bushAgeProfile, gapSummary, gapSizeDetails, healthDistribution, tableSummary }',
      },
      '404': { description: 'Not found' },
    },
  },
};
