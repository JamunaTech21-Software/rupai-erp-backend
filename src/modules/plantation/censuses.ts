import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import {
  type CustomPlan,
  defineCustomWrite,
  openRequest,
  pendingValues,
  requestNo,
  runCustomWrite,
  show,
} from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { int, list, longText, num, optInt, optNum, option, ref, reqDate, text } from '../../lib/fields.js';
import { type Tx, readHistory, writeHistory } from '../../lib/history.js';
import { newId } from '../../lib/ids.js';
import { currentUserId, defineResource } from '../../lib/resource.js';
import { toJson } from '../../lib/serialize.js';
import { z } from '../../lib/validation.js';
import { zodFields } from '../../middleware/error-handler.js';
import { checkLocation } from '../estate/location.js';
import { fileUrl } from '../files/service.js';

/**
 * RP1-20 B.4 Plant Census: `PlantCensus.jsx`. The form's `register(...)` names with the page's own messages,
 * plus the row-wise table (`rowWiseTable.headers` keys) as `rows`, and photos / documents as file ids.
 * The cards, charts and census history come from `GET /plant-censuses/{id}/report`.
 *
 * RP1-124 M.1: one save of the form is one approval request. `POST` takes `rows`, `photos` and `documents`;
 * `PUT` takes the census fields with `rowChanges` and `fileChanges`. The separate row and file endpoints of
 * RP1-75 stay until the frontend has moved (RP1-134).
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
  module: 'plantation',
  page: 'Plant Census',
  describe: (r) => show('Field', r.fieldBlockName, '—', r.censusDate),
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
  fileChanges: { key: 'fileChanges', kinds: { photos: 'photo', documents: 'document' } },
  createOnly: ['photos', 'documents'],
  children: [
    {
      key: 'rows',
      model: 'plantCensusRow',
      parentKey: 'censusId',
      schema: rowSchema,
      compute: (row) => ({ ...row, gapPercentage: gap(row as Parameters<typeof gap>[0]) }),
      createOnly: true,
      badge: 'plantCensusRow',
      changes: {
        key: 'rowChanges',
        history: 'row',
        noun: 'row',
        unique: { field: 'rowNo', message: 'This row is already in the census.' },
      },
    },
  ],
  orderBy: [{ censusDate: 'desc' }],
  /** RP1-81 J.4 Plant Census List: each census's row totals and data-entry status. */
  enrich: async (rows) => {
    const sums = await db.plantCensusRow.groupBy({
      by: ['censusId'],
      where: { censusId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
      _sum: { expectedPlants: true, livePlants: true, deadPlants: true, missingPlants: true },
    });
    const by = new Map(sums.map((g) => [g.censusId, g]));
    return new Map(
      rows.map((r) => {
        const g = by.get(r.id);
        const count = g?._count._all ?? 0;
        const expected = g?._sum.expectedPlants ?? 0;
        const live = g?._sum.livePlants ?? 0;
        const total = Number(r.totalSelectedRows);
        return [
          r.id,
          {
            rowCount: count,
            expectedPlants: expected,
            livePlants: live,
            deadPlants: g?._sum.deadPlants ?? 0,
            missingPlants: g?._sum.missingPlants ?? 0,
            survivalRate: expected ? round2((live / expected) * 100) : 0,
            dataEntryStatus: count >= total ? 'Completed' : count ? 'In Progress' : 'Pending',
          },
        ];
      }),
    );
  },
  export: {
    fileName: 'plant-censuses',
    sheet: 'Plant Censuses',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Field', value: (row) => row.fieldBlockName, width: 12 },
      { header: 'Estate', value: (row) => row.estateName, width: 24 },
      { header: 'Census Date', value: (row) => row.censusDate, width: 12 },
      { header: 'Census Year', value: (row) => row.censusYear, width: 12 },
      { header: 'Survey Type', value: (row) => row.surveyType, width: 14 },
      { header: 'Rows', value: (row) => row.rowCount, width: 8 },
      { header: 'Live Plants', value: (row) => row.livePlants, width: 12 },
      { header: 'Dead Plants', value: (row) => row.deadPlants, width: 12 },
      { header: 'Survival %', value: (row) => row.survivalRate, width: 11 },
      { header: 'Status', value: (row) => row.dataEntryStatus, width: 12 },
    ],
  },
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

// ---- RP1-75 I.4: rows and files, one approval request each ----------------------------------------------

export const censusRowsRouter = Router();

const liveCensus = async (id: string) => {
  const census = await db.plantCensus.findFirst({ where: { id, deletedAt: null } });
  if (!census) throw notFound('Plant census');
  return census;
};

const fieldCode = async (fieldBlock: string) =>
  (await db.fieldBlock.findUnique({ where: { id: fieldBlock }, select: { fieldCode: true } }))?.fieldCode ??
  '';

const sameText = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

/** A row's fields, checked; its number must be free on the census and in the other pending row requests. */
async function parseCensusRow(censusId: string, body: unknown, rowId: string) {
  const parsed = rowSchema.safeParse(body ?? {});
  if (!parsed.success)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', zodFields(parsed.error));
  const row = { ...parsed.data, rowNo: parsed.data.rowNo.trim() };
  const taken = await db.plantCensusRow.findFirst({
    where: { censusId, rowNo: row.rowNo, NOT: { id: rowId } },
  });
  if (taken)
    throw new AppError('DUPLICATE', 'This row is already in the census.', {
      rowNo: 'This row is already in the census.',
    });
  const waiting = await pendingValues('plantCensusRow', rowId);
  if (waiting.some((p) => p.censusId === censusId && sameText(p.rowNo, row.rowNo)))
    throw new AppError('DUPLICATE', 'This row is already in the census.', {
      rowNo: 'This row number is already used by a request waiting for approval.',
    });
  return { ...row, gapPercentage: gap(row) };
}

/**
 * Writes one change of a census's rows / files to the census's edit log ("Data Entry" in its history).
 * The census itself is not touched (its `updatedAt` stays), so a pending census edit does not go stale.
 */
const logOnCensus = (
  tx: Tx,
  censusId: string,
  key: 'row' | 'file',
  oldData: unknown,
  newData: unknown,
  userId: string,
  approvalId: string | null,
) =>
  writeHistory(tx, {
    resource: 'plantCensus',
    recordId: censusId,
    action: 'update',
    oldData: oldData ? { [key]: toJson(oldData) } : undefined,
    newData: newData ? { [key]: toJson(newData) } : undefined,
    userId,
    approvalId,
  });

const rowWrite = defineCustomWrite({
  key: 'plantCensusRow',
  module: 'plantation',
  resource: 'plantCensusRow',
  page: 'Plant Census',
  plan: async ({ params, body, action, recordId }): Promise<CustomPlan> => {
    const census = await liveCensus(params.id ?? '');
    const before =
      action === 'create'
        ? null
        : await db.plantCensusRow.findFirst({ where: { id: params.rowId ?? '', censusId: census.id } });
    if (action !== 'create' && !before) throw notFound('Row');
    const id = before?.id ?? recordId ?? newId();
    const data = action === 'delete' ? null : await parseCensusRow(census.id, body, id);
    return {
      recordId: id,
      summary: `Field ${await fieldCode(census.fieldBlock)}: Row ${data?.rowNo ?? before?.rowNo ?? ''}`,
      oldData: before ? toJson(before) : null,
      newData: data ? { censusId: census.id, ...data } : undefined,
      run: async (tx, userId, approvalId) => {
        if (action === 'create' && data) {
          const last = await tx.plantCensusRow.aggregate({
            where: { censusId: census.id },
            _max: { position: true },
          });
          const position = (last._max.position ?? -1) + 1;
          await tx.plantCensusRow.create({ data: { ...data, id, censusId: census.id, position } });
          await logOnCensus(tx, census.id, 'row', null, { id, ...data }, userId, approvalId);
        } else if (action === 'update' && data && before) {
          await tx.plantCensusRow.update({ where: { id }, data });
          await logOnCensus(tx, census.id, 'row', before, { id, ...data }, userId, approvalId);
        } else if (action === 'delete' && before) {
          await tx.plantCensusRow.delete({ where: { id } });
          await logOnCensus(tx, census.id, 'row', before, null, userId, approvalId);
        }
      },
    };
  },
});

const rowAnswer = async (id: string) => {
  const row = await db.plantCensusRow.findUnique({ where: { id } });
  if (!row) return null;
  const { position: _p, censusId: _c, ...rest } = row;
  return toJson({ ...rest, pendingRequest: null });
};

censusRowsRouter.post('/:id/rows', async (req, res) => {
  const { queued, plan } = await runCustomWrite(
    rowWrite,
    { params: req.params, body: req.body, action: 'create' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  res.status(201).json(await rowAnswer(plan.recordId));
});

censusRowsRouter.put('/:id/rows/:rowId', async (req, res) => {
  const { queued, plan } = await runCustomWrite(
    rowWrite,
    { params: req.params, body: req.body, action: 'update' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  res.json(await rowAnswer(plan.recordId));
});

censusRowsRouter.delete('/:id/rows/:rowId', async (req, res) => {
  const { queued } = await runCustomWrite(
    rowWrite,
    { params: req.params, body: null, action: 'delete' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  res.status(204).end();
});

const FILE_KINDS = ['photos', 'documents'] as const;
type FileKind = (typeof FILE_KINDS)[number];
const fileBody = z.object({
  kind: z.enum(FILE_KINDS, { error: 'Use photos or documents.' }),
  fileId: z.string({ error: 'Upload the file first.' }).trim().min(1, 'Upload the file first.'),
});
const idsOf = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const kindOf = (census: { photos: unknown; documents: unknown }, fileId: string): FileKind | null =>
  idsOf(census.photos).includes(fileId)
    ? 'photos'
    : idsOf(census.documents).includes(fileId)
      ? 'documents'
      : null;
const LABEL: Record<FileKind, string> = { photos: 'Photo', documents: 'Document' };

/** Add or remove one photo / document; the file id is the request's record. */
const fileWrite = defineCustomWrite({
  key: 'plantCensusFile',
  module: 'plantation',
  resource: 'plantCensusFile',
  page: 'Plant Census',
  plan: async ({ params, body, action, recordId }): Promise<CustomPlan> => {
    const census = await liveCensus(params.id ?? '');
    let kind: FileKind;
    let fileId: string;
    if (action === 'create') {
      const parsed = fileBody.safeParse(body ?? {});
      if (!parsed.success)
        throw new AppError('VALIDATION', 'Please correct the highlighted fields.', zodFields(parsed.error));
      ({ kind, fileId } = parsed.data);
      if (!(await db.storedFile.count({ where: { id: fileId } })))
        throw new AppError('VALIDATION', 'Please correct the highlighted fields.', {
          fileId: 'Upload the file again.',
        });
      if (kindOf(census, fileId))
        throw new AppError('DUPLICATE', 'This file is already on the census.', {
          fileId: 'This file is already on the census.',
        });
      // When asking (not on approval), a second request for the same file is refused.
      const open = recordId ? null : await openRequest('plantCensusFile', fileId);
      if (open)
        throw new AppError('DUPLICATE', `This file already has a pending request (${requestNo(open.seq)}).`);
    } else {
      fileId = params.fileId ?? '';
      const found = kindOf(census, fileId);
      if (!found) throw notFound('File');
      kind = found;
    }
    const name =
      (await db.storedFile.findUnique({ where: { id: fileId }, select: { name: true } }))?.name ?? '';
    const entry = { kind, fileId, name };
    return {
      recordId: fileId,
      summary: `Field ${await fieldCode(census.fieldBlock)}: ${LABEL[kind]} ${name}`,
      oldData: action === 'create' ? null : entry,
      newData: action === 'create' ? entry : undefined,
      run: async (tx, userId, approvalId) => {
        // Read again in the transaction, so two approved files never overwrite each other.
        const now = await tx.plantCensus.findUniqueOrThrow({ where: { id: census.id } });
        const ids = idsOf(now[kind]);
        const next = action === 'create' ? [...ids, fileId] : ids.filter((x) => x !== fileId);
        // updatedAt is kept, so a pending edit of the census fields does not go stale.
        await tx.plantCensus.update({
          where: { id: census.id },
          data: { [kind]: next, updatedAt: now.updatedAt },
        });
        await logOnCensus(
          tx,
          census.id,
          'file',
          action === 'create' ? null : entry,
          action === 'create' ? entry : null,
          userId,
          approvalId,
        );
      },
    };
  },
});

const filesAnswer = async (censusId: string) => {
  const c = await db.plantCensus.findUniqueOrThrow({ where: { id: censusId } });
  return {
    photos: idsOf(c.photos),
    photosUrl: idsOf(c.photos).map(fileUrl),
    documents: idsOf(c.documents),
    documentsUrl: idsOf(c.documents).map(fileUrl),
  };
};

censusRowsRouter.post('/:id/files', async (req, res) => {
  const { queued } = await runCustomWrite(
    fileWrite,
    { params: req.params, body: req.body, action: 'create' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  res.status(201).json(await filesAnswer(req.params.id));
});

censusRowsRouter.delete('/:id/files/:fileId', async (req, res) => {
  const { queued } = await runCustomWrite(
    fileWrite,
    { params: req.params, body: null, action: 'delete' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  res.json(await filesAnswer(req.params.id));
});

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
const queuedAnswer = { description: 'Sent for approval (Plantation approval On): { message, approval }' };
const tags = ['Plant census'];
docsPaths['/plant-censuses/{id}/rows'] = {
  post: {
    tags,
    summary:
      'Add one row (rowNo, rowLength, plantsPerMeter, expectedPlants, livePlants, deadPlants, missingPlants)',
    parameters: [idParam],
    responses: {
      '201': { description: 'The row, with gapPercentage' },
      '202': queuedAnswer,
      '400': { description: 'error.fields' },
      '409': { description: 'The row number is already used (saved or waiting for approval)' },
    },
  },
};
docsPaths['/plant-censuses/{id}/rows/{rowId}'] = {
  put: {
    tags,
    summary: 'Change one row',
    parameters: [idParam, { name: 'rowId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': { description: 'The row' },
      '202': queuedAnswer,
      '400': { description: 'error.fields' },
      '409': { description: 'The row already has a pending request, or the row number is used' },
    },
  },
  delete: {
    tags,
    summary: 'Remove one row',
    parameters: [idParam, { name: 'rowId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { '204': { description: 'Removed' }, '202': queuedAnswer, '409': { description: 'Pending' } },
  },
};
docsPaths['/plant-censuses/{id}/files'] = {
  post: {
    tags,
    summary: 'Add one uploaded photo / document: { kind: "photos" | "documents", fileId }',
    parameters: [idParam],
    responses: {
      '201': { description: '{ photos, photosUrl, documents, documentsUrl }' },
      '202': queuedAnswer,
      '400': { description: 'error.fields' },
      '409': { description: 'Already on the census, or already pending' },
    },
  },
};
docsPaths['/plant-censuses/{id}/files/{fileId}'] = {
  delete: {
    tags,
    summary: 'Remove one photo / document',
    parameters: [idParam, { name: 'fileId', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': { description: '{ photos, photosUrl, documents, documentsUrl }' },
      '202': queuedAnswer,
      '404': { description: 'Not on this census' },
      '409': { description: 'Already pending' },
    },
  },
};

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
