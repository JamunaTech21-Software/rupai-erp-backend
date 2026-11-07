import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { defineCustomWrite, pendingBadges, runCustomWrite, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { int, longText, num, optNum, option, ref, reqDate, text } from '../../lib/fields.js';
import { centre, isPolygon } from '../../lib/geo.js';
import { type Tx, writeHistory } from '../../lib/history.js';
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
  module: 'plantation',
  page: 'Bush Register',
  describe: (r) => show('Field', r.fieldBlockName, '—', r.surveyDate),
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
  /** RP1-81 J.4 Bush Register List: each register's row count and bush totals. */
  enrich: async (rows) => {
    const sums = await db.bushRegisterRow.groupBy({
      by: ['registerId'],
      where: { registerId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
      _sum: { totalBush: true, productive: true, dead: true, missing: true },
    });
    const by = new Map(sums.map((g) => [g.registerId, g]));
    return new Map(
      rows.map((r) => {
        const g = by.get(r.id);
        const total = g?._sum.totalBush ?? 0;
        const dead = g?._sum.dead ?? 0;
        const missing = g?._sum.missing ?? 0;
        return [
          r.id,
          {
            rowCount: g?._count._all ?? 0,
            totalBush: total,
            productive: g?._sum.productive ?? 0,
            dead,
            missing,
            gap: total ? round2(((dead + missing) / total) * 100) : 0,
          },
        ];
      }),
    );
  },
  export: {
    fileName: 'bush-registers',
    sheet: 'Bush Registers',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Field', value: (row) => row.fieldBlockName, width: 12 },
      { header: 'Estate', value: (row) => row.estateName, width: 24 },
      { header: 'Planting Year', value: (row) => row.plantingYear, width: 13 },
      { header: 'Survey Date', value: (row) => row.surveyDate, width: 12 },
      { header: 'Rows', value: (row) => row.rowCount, width: 8 },
      { header: 'Total Bush', value: (row) => row.totalBush, width: 11 },
      { header: 'Productive', value: (row) => row.productive, width: 11 },
      { header: 'Dead', value: (row) => row.dead, width: 8 },
      { header: 'Missing', value: (row) => row.missing, width: 9 },
      { header: 'Gap %', value: (row) => row.gap, width: 8 },
    ],
  },
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

/** One row's own rules; messages by field. */
function checkRow(body: unknown) {
  const parsed = rowSchema.safeParse(body ?? {});
  const invalid: Record<string, string> = parsed.success ? {} : zodFields(parsed.error);
  if (parsed.success) {
    const r = parsed.data;
    if (r.from < 1) invalid.from = 'Must be 1 or more.';
    if (r.to < r.from) invalid.to = 'Must not be less than From.';
    if (r.productive + r.dead + r.missing > r.totalBush)
      invalid.totalBush = 'Productive, dead and missing bushes cannot be more than the total.';
  }
  return { parsed, invalid };
}

/** Checks one row and works out its gap; every mistake comes back in one answer. */
async function parseRow(registerId: string, body: unknown, rowId?: string) {
  const { parsed, invalid } = checkRow(body);
  if (parsed.success) {
    const r = parsed.data;
    const clash = await db.bushRegisterRow.findFirst({
      where: { registerId, rowNo: r.rowNo, ...(rowId ? { id: { not: rowId } } : {}) },
    });
    if (clash) invalid.rowNo = 'This row is already in the register.';
  }
  if (!parsed.success || Object.keys(invalid).length)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', invalid);
  return { ...parsed.data, gap: gapOf(parsed.data) };
}

/** The register's edit-log entry for a row change, as `{ row }` before and after. */
async function logRow(
  tx: Tx,
  registerId: string,
  oldRow: unknown,
  newRow: unknown,
  userId: string,
  approvalId: string | null,
) {
  await tx.bushRegister.update({ where: { id: registerId }, data: { updatedBy: userId } });
  await writeHistory(tx, {
    resource: 'bushRegister',
    recordId: registerId,
    action: 'update',
    oldData: oldRow ? { row: toJson(oldRow) } : undefined,
    newData: newRow ? { row: toJson(newRow) } : undefined,
    userId,
    approvalId,
  });
}

bushRowsRouter.get('/:id/rows', async (req, res) => {
  const register = await liveRegister(req.params.id);
  const { page, perPage } = Paging.parse(req.query);
  const all = await db.bushRegisterRow.findMany({
    where: { registerId: register.id },
    orderBy: [{ from: 'asc' }, { rowNo: 'asc' }],
  });
  const badges = await pendingBadges(
    'bushRegisterRow',
    all.map((r) => r.id),
  );
  res.json({
    data: (toJson(all.slice((page - 1) * perPage, page * perPage)) as Record<string, unknown>[]).map(
      (row) => ({
        ...row,
        pendingRequest: badges.get(String(row.id)) ?? null,
      }),
    ),
    meta: { page, perPage, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / perPage)) },
    tableSummary: tableSummary(all),
  });
});

/** Add / edit / remove a register row (RP1-70: through approval when Plantation's approval is On). */
const rowWrite = defineCustomWrite({
  key: 'bushRegisterRow',
  module: 'plantation',
  resource: 'bushRegisterRow',
  page: 'Bush Register',
  plan: async ({ params, body, action, recordId }) => {
    const register = await liveRegister(params.id ?? '');
    const before =
      action === 'create'
        ? null
        : await db.bushRegisterRow.findFirst({ where: { id: params.rowId ?? '', registerId: register.id } });
    if (action !== 'create' && !before) throw notFound('Row');
    const data = action === 'delete' ? null : await parseRow(register.id, body, before?.id);
    const field = await db.fieldBlock.findUnique({
      where: { id: register.fieldBlock },
      select: { fieldCode: true },
    });
    const id = before?.id ?? recordId ?? newId();
    return {
      recordId: id,
      summary: `Field ${field?.fieldCode ?? ''}: Row ${data?.rowNo ?? before?.rowNo ?? ''}`,
      oldData: before ? toJson(before) : null,
      newData: data ?? undefined,
      run: async (tx, userId, approvalId) => {
        if (action === 'create' && data) {
          await tx.bushRegisterRow.create({ data: { ...data, id, registerId: register.id } });
          await logRow(tx, register.id, null, { id, ...data }, userId, approvalId);
        } else if (action === 'update' && data && before) {
          await tx.bushRegisterRow.update({ where: { id }, data });
          await logRow(tx, register.id, before, { id, ...data }, userId, approvalId);
        } else if (action === 'delete' && before) {
          await tx.bushRegisterRow.delete({ where: { id } });
          await logRow(tx, register.id, before, null, userId, approvalId);
        }
      },
    };
  },
});

/** The most rows one save or import can change: a request must stay readable and small enough to send. */
const MAX_ROW_CHANGES = 2000;
const VALIDATION = 'Please correct the highlighted fields.';
const listOf = (v: unknown): unknown[] | null => (v === undefined ? [] : Array.isArray(v) ? v : null);
const noCase = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/**
 * RP1-130 M.3: `{ add, update, remove }` of a register's rows as one approval request, for Save Changes and the
 * import. Registers are long and shown in pages, so only changed rows are sent. The request belongs to the
 * register, so a register has one open request. The one-row endpoints stay until the frontend has moved
 * (RP1-134). Keys in `error.fields` are `add.1.rowNo`, `update.0.from`, `remove.2`.
 */
const rowChangesWrite = defineCustomWrite({
  key: 'bushRegisterRowChanges',
  module: 'plantation',
  resource: 'bushRegister',
  page: 'Bush Register',
  plan: async ({ params, body }) => {
    const register = await liveRegister(params.id ?? '');
    const given = (body ?? {}) as { add?: unknown; update?: unknown; remove?: unknown };
    const add = listOf(given.add);
    const update = listOf(given.update);
    const remove = listOf(given.remove);
    if (!add || !update || !remove)
      throw new AppError('VALIDATION', VALIDATION, { rows: 'Use add, update and remove lists.' });
    const total = add.length + update.length + remove.length;
    if (!total) throw new AppError('VALIDATION', VALIDATION, { rows: 'There are no changes to save.' });
    if (total > MAX_ROW_CHANGES)
      throw new AppError('VALIDATION', VALIDATION, {
        rows: `One save can change at most ${MAX_ROW_CHANGES} rows. This one has ${total}.`,
      });
    const saved = await db.bushRegisterRow.findMany({ where: { registerId: register.id } });
    const byId = new Map(saved.map((r) => [r.id, r]));
    const invalid: Record<string, string> = {};
    const touched = new Set<string>();
    const known = (id: unknown, path: string) => {
      const row = typeof id === 'string' ? byId.get(id) : undefined;
      if (!row) invalid[path] = 'This row no longer exists.';
      else if (touched.has(row.id)) invalid[path] = 'This row is changed twice.';
      else {
        touched.add(row.id);
        return row;
      }
      return null;
    };
    const removed = remove.flatMap((id, i) => known(id, `remove.${i}`) ?? []);
    const read = (raw: unknown, path: string) => {
      const { parsed, invalid: own } = checkRow(raw);
      for (const [key, message] of Object.entries(own)) invalid[`${path}.${key}`] = message;
      return parsed.success && !Object.keys(own).length ? { ...parsed.data, gap: gapOf(parsed.data) } : null;
    };
    const changed = update.flatMap((raw, i) => {
      const before = known((raw as { id?: unknown } | null)?.id, `update.${i}.id`);
      const values = before ? read(raw, `update.${i}`) : null;
      return before && values ? [{ id: before.id, before, values }] : [];
    });
    const added = add.flatMap((raw, i) => read(raw, `add.${i}`) ?? []);
    const seen = new Set(saved.filter((r) => !touched.has(r.id)).map((r) => noCase(r.rowNo)));
    const claim = (raw: unknown, path: string) => {
      const value = noCase((raw as { rowNo?: unknown } | null)?.rowNo);
      if (!value) return;
      if (seen.has(value)) invalid[`${path}.rowNo`] ??= 'This row is already in the register.';
      seen.add(value);
    };
    update.forEach((raw, i) => claim(raw, `update.${i}`));
    add.forEach((raw, i) => claim(raw, `add.${i}`));
    if (Object.keys(invalid).length) throw new AppError('VALIDATION', VALIDATION, invalid);
    const field = await db.fieldBlock.findUnique({
      where: { id: register.fieldBlock },
      select: { fieldCode: true },
    });
    const part = (n: number, verb: string) => (n ? `${n} row${n === 1 ? '' : 's'} ${verb}` : '');
    const counts = [
      part(added.length, 'added'),
      part(changed.length, 'changed'),
      part(removed.length, 'removed'),
    ];
    return {
      recordId: register.id,
      summary: `Field ${field?.fieldCode ?? ''}: ${counts.filter(Boolean).join(', ')}`,
      oldData: toJson({ changed: changed.map((c) => c.before), removed }),
      newData: {
        rowChanges: {
          added,
          changed: changed.map(({ id, before, values }) => ({ id, old: before, new: values })),
          removed,
        },
      },
      run: async (tx, userId, approvalId) => {
        await tx.bushRegister.update({ where: { id: register.id }, data: { updatedBy: userId } });
        const log = (oldRow: unknown, newRow: unknown) =>
          writeHistory(tx, {
            resource: 'bushRegister',
            recordId: register.id,
            action: 'update',
            oldData: oldRow ? { row: toJson(oldRow) } : undefined,
            newData: newRow ? { row: toJson(newRow) } : undefined,
            userId,
            approvalId,
          });
        if (removed.length)
          await tx.bushRegisterRow.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
        for (const row of removed) await log(row, null);
        for (const { id, before, values } of changed) {
          await tx.bushRegisterRow.update({ where: { id }, data: values });
          await log(before, { id, ...values });
        }
        const rows = added.map((row) => ({ ...row, id: newId(), registerId: register.id }));
        if (rows.length) await tx.bushRegisterRow.createMany({ data: rows });
        for (const row of rows) await log(null, row);
      },
    };
  },
});

bushRowsRouter.post('/:id/rows/changes', async (req, res) => {
  const { queued, plan } = await runCustomWrite(
    rowChangesWrite,
    { params: req.params, body: req.body, action: 'update' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  res.json((plan.newData as { rowChanges: unknown }).rowChanges);
});

bushRowsRouter.post('/:id/rows', async (req, res) => {
  const { queued, plan } = await runCustomWrite(
    rowWrite,
    { params: req.params, body: req.body, action: 'create' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  res.status(201).json(toJson(await db.bushRegisterRow.findUnique({ where: { id: plan.recordId } })));
});

bushRowsRouter.put('/:id/rows/:rowId', async (req, res) => {
  const { queued, plan } = await runCustomWrite(
    rowWrite,
    { params: req.params, body: req.body, action: 'update' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  res.json(toJson(await db.bushRegisterRow.findUnique({ where: { id: plan.recordId } })));
});

bushRowsRouter.delete('/:id/rows/:rowId', async (req, res) => {
  const { queued } = await runCustomWrite(
    rowWrite,
    { params: req.params, body: null, action: 'delete' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
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
docsPaths['/bush-registers/{id}/rows/changes'] = {
  post: {
    tags,
    summary: 'Add, change and remove rows as one save: { add, update (with id), remove (ids) }',
    parameters: [idParam],
    responses: {
      '200': { description: 'What changed: { added, changed, removed }' },
      '202': { description: 'Sent for approval as one request: { message, approval }' },
      '400': { description: 'error.fields, such as add.1.rowNo' },
      '409': { description: 'The register already has an open request' },
    },
  },
};
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
    responses: {
      '201': { description: 'The row' },
      '202': { description: 'Sent for approval (module approval On): { message, approval }' },
      '400': { description: 'error.fields' },
    },
  },
};
docsPaths['/bush-registers/{id}/rows/{rowId}'] = {
  put: {
    tags,
    summary: 'Change a row',
    parameters: [idParam, rowParam],
    responses: {
      '200': { description: 'The row' },
      '202': { description: 'Sent for approval (module approval On): { message, approval }' },
      '400': { description: 'error.fields' },
    },
  },
  delete: {
    tags,
    summary: 'Remove a row',
    parameters: [idParam, rowParam],
    responses: {
      '204': { description: 'Removed' },
      '202': { description: 'Sent for approval (module approval On): { message, approval }' },
      '404': { description: 'Not found' },
    },
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
