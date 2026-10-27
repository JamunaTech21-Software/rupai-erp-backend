import busboy from 'busboy';
import ExcelJS from 'exceljs';
import { type Request, Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { writeHistory } from '../../lib/history.js';
import { newId } from '../../lib/ids.js';
import { currentUserId } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { zodFields } from '../../middleware/error-handler.js';
import { checkWorkerDates, nextWorkerIds, WORKER_FILES, workerDefaults, workerSchema } from './workers.js';

/**
 * RP1-24 C.3 Worker CSV / Excel upload (the Import button on Worker Management). `GET /workers/import/template`
 * gives the columns; `POST /workers/import` checks every row with the Add New Worker rules and saves all of
 * them, or none: every problem comes back in `error.fields` as `rows.<spreadsheet row>.<column>`.
 * Files (photo, NID scans) cannot travel in a spreadsheet, so they are added later from the worker's form.
 */
const FILE_KEYS = new Set<string>(WORKER_FILES);
const importSchema = z.object(
  Object.fromEntries(Object.entries(workerSchema.shape).filter(([key]) => !FILE_KEYS.has(key))),
);
export const COLUMNS = Object.keys(importSchema.shape);
const parsedEmpty = importSchema.safeParse({});
const REQUIRED = new Set(parsedEmpty.success ? [] : Object.keys(zodFields(parsedEmpty.error)));

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;

/** Select columns: "Tea Plucking" and "tea-plucking" both mean the form's value `tea-plucking`. */
const OPTION_COLUMNS = new Set([
  'workerType',
  'category',
  'title',
  'gender',
  'bloodGroup',
  'maritalStatus',
  'nationality',
  'religion',
  'gardenUnit',
  'section',
  'jobTask',
  'workerStatus',
  'employmentType',
  'jobNature',
  'reportingTo',
  'workingLocation',
  'employmentStatus',
  'district',
  'upazila',
  'landDistributed',
  'landType',
  'educationLevel',
  'skillTraining',
  'languageKnown',
]);
const PHONE_COLUMNS = new Set(['mobileNo', 'alternateMobile', 'emergencyContactNo']);
const DATE_COLUMNS = new Set(['dateOfBirth', 'joinDate', 'probationEndDate', 'issueDate', 'validTill']);

const NOTES: Record<string, string> = {
  dateOfBirth: 'YYYY-MM-DD or DD-MM-YYYY',
  joinDate: 'YYYY-MM-DD or DD-MM-YYYY',
  probationEndDate: 'YYYY-MM-DD or DD-MM-YYYY',
  issueDate: 'YYYY-MM-DD or DD-MM-YYYY',
  validTill: 'YYYY-MM-DD or DD-MM-YYYY',
  mobileNo: '01XXXXXXXXX',
  alternateMobile: '01XXXXXXXXX',
  emergencyContactNo: '01XXXXXXXXX',
  sameAsPresentAddress: 'yes / no',
  bloodGroup: 'A+, A-, B+, B-, AB+, AB-, O+, O-',
  totalLand: 'acre',
};

const slug = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[\s_/]+/g, '-');

function bloodGroup(v: string): string {
  const m = /^(a|b|ab|o)\s*([+-])$/i.exec(v.trim());
  return m ? `${m[1]!.toLowerCase()}-${m[2] === '+' ? 'positive' : 'negative'}` : slug(v);
}

function date(v: string): string {
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v.trim());
  return dmy ? `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}` : v.trim();
}

/** One spreadsheet row → the form's values. */
function normalise(raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const v = value.trim();
    if (v === '') out[key] = '';
    else if (key === 'bloodGroup') out[key] = bloodGroup(v);
    else if (OPTION_COLUMNS.has(key)) out[key] = slug(v);
    else if (PHONE_COLUMNS.has(key)) {
      const digits = v.replace(/[\s-]/g, '');
      out[key] = /^1[3-9]\d{8}$/.test(digits) ? `0${digits}` : digits;
    } else if (DATE_COLUMNS.has(key)) out[key] = date(v);
    else if (key === 'sameAsPresentAddress') out[key] = /^(yes|y|true|1)$/i.test(v);
    else out[key] = v;
  }
  return out;
}

/** A small CSV reader: quoted fields, "" inside quotes, CRLF or LF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A cell as text: dates as YYYY-MM-DD, formulas as their result. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result);
    if ('richText' in value) return value.richText.map((t) => t.text).join('');
    if ('text' in value) return String(value.text);
    return '';
  }
  return String(value);
}

async function readSheet(name: string, data: Buffer): Promise<string[][]> {
  const isXlsx = data.subarray(0, 2).toString('latin1') === 'PK';
  if (isXlsx) {
    const book = new ExcelJS.Workbook();
    try {
      await book.xlsx.load(data as unknown as ArrayBuffer);
    } catch {
      throw new AppError('VALIDATION', 'The file could not be read.', {
        file: 'The Excel file could not be read.',
      });
    }
    const sheet = book.worksheets[0];
    if (!sheet) return [];
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, n) => {
      const values = row.values as ExcelJS.CellValue[];
      rows[n - 1] = values.slice(1).map(cellText);
    });
    return Array.from(rows, (r) => r ?? []);
  }
  if (!/\.csv$/i.test(name) && data.includes(0))
    throw new AppError('VALIDATION', 'The file could not be read.', {
      file: 'Upload an .xlsx or .csv file.',
    });
  return parseCsv(data.toString('utf8'));
}

/** Reads the one multipart field `file` into memory (at most 5 MB). */
function receiveSheet(req: Request): Promise<{ name: string; data: Buffer }> {
  const refuse = (message: string) => new AppError('VALIDATION', message, { file: message });
  return new Promise((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_BYTES } });
    } catch {
      reject(refuse('Choose a file to upload.'));
      return;
    }
    let found = false;
    parser.on('file', (field, stream, info) => {
      if (field !== 'file' || found) {
        stream.resume();
        return;
      }
      found = true;
      const chunks: Buffer[] = [];
      let tooBig = false;
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        tooBig = true;
      });
      stream.on('end', () => {
        if (tooBig) reject(refuse('The file is larger than 5 MB.'));
        else resolve({ name: info.filename || 'workers', data: Buffer.concat(chunks) });
      });
    });
    parser.on('close', () => {
      if (!found) reject(refuse('Choose a file to upload.'));
    });
    parser.on('error', () => reject(refuse('The upload could not be read.')));
    req.pipe(parser);
  });
}

export const workerImportRouter = Router();

workerImportRouter.get('/import/template', async (req, res) => {
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="workers-template.csv"');
    res.send(`\uFEFF${COLUMNS.join(',')}\r\n`);
    return;
  }
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Workers');
  sheet.columns = COLUMNS.map((key) => ({
    header: key,
    key,
    width: Math.max(14, key.length + 2),
    // Typed as text, so 017… keeps its 0 and dates stay as typed.
    style: PHONE_COLUMNS.has(key) || DATE_COLUMNS.has(key) ? { numFmt: '@' } : {},
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const guide = book.addWorksheet('Guide');
  guide.columns = [
    { header: 'Column', key: 'column', width: 24 },
    { header: 'Required', key: 'required', width: 10 },
    { header: 'Notes', key: 'notes', width: 60 },
  ];
  guide.getRow(1).font = { bold: true };
  for (const key of COLUMNS)
    guide.addRow({
      column: key,
      required: REQUIRED.has(key) ? 'Yes' : '',
      notes:
        NOTES[key] ??
        (OPTION_COLUMNS.has(key) ? 'A value from the Add New Worker form (e.g. tea-plucking)' : ''),
    });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="workers-template.xlsx"');
  res.send(Buffer.from(await book.xlsx.writeBuffer()));
});

workerImportRouter.post('/import', async (req, res) => {
  const userId = currentUserId(req);
  const { name, data } = await receiveSheet(req);
  const [header = [], ...body] = await readSheet(name, data);

  // Columns are matched by name, ignoring case and spaces.
  const byName = new Map(COLUMNS.map((c) => [c.toLowerCase(), c]));
  const columns = header.map((h) => byName.get(h.trim().toLowerCase().replace(/\s+/g, '')) ?? null);
  const unknown = header.filter((h, i) => h.trim() && !columns[i]);
  const missing = [...REQUIRED].filter((c) => !columns.includes(c));
  if (unknown.length || missing.length)
    throw new AppError('VALIDATION', 'The columns do not match the template.', {
      file: [
        missing.length ? `Missing columns: ${missing.join(', ')}.` : '',
        unknown.length ? `Unknown columns: ${unknown.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
    });

  const rows = body
    .map((cells, i) => ({ line: i + 2, cells }))
    .filter(({ cells }) => cells.some((c) => c.trim() !== ''));
  if (!rows.length)
    throw new AppError('VALIDATION', 'The file has no workers.', { file: 'The file has no workers.' });
  if (rows.length > MAX_ROWS)
    throw new AppError('VALIDATION', 'The file is too long.', {
      file: `At most ${MAX_ROWS} workers per file; this one has ${rows.length}.`,
    });

  const invalid: Record<string, string> = {};
  const values: Record<string, unknown>[] = [];
  for (const { line, cells } of rows) {
    const raw: Record<string, string> = {};
    columns.forEach((column, i) => {
      if (column) raw[column] = cells[i] ?? '';
    });
    const parsed = importSchema.safeParse(normalise(raw));
    const problems = parsed.success ? checkWorkerDates(parsed.data) : zodFields(parsed.error);
    for (const [column, message] of Object.entries(problems)) invalid[`rows.${line}.${column}`] = message;
    if (parsed.success) values.push({ ...parsed.data, ...workerDefaults(parsed.data) });
  }
  const badRows = new Set(Object.keys(invalid).map((k) => k.split('.')[1])).size;
  if (badRows)
    throw new AppError(
      'VALIDATION',
      `${badRows} of ${rows.length} rows have problems. Nothing was imported.`,
      invalid,
    );

  const ids = await nextWorkerIds(values.length);
  const created = values.map((v, i): Record<string, unknown> & { id: string; workerId: string } => ({
    ...v,
    id: newId(),
    workerId: ids[i]!,
  }));
  await db.$transaction(
    async (tx) => {
      await tx.worker.createMany({
        data: created.map((w) => ({ ...w, createdBy: userId, updatedBy: userId })) as never,
      });
      for (const w of created)
        await writeHistory(tx, { resource: 'worker', recordId: w.id, action: 'create', newData: w, userId });
    },
    { timeout: 120_000 },
  );
  res.status(201).json({
    imported: created.length,
    workers: created.map((w) => ({
      id: w.id,
      workerId: w.workerId,
      workerName: [w.firstName, w.middleName, w.lastName].filter(Boolean).map(String).join(' '),
    })),
  });
});

docsPaths['/workers/import/template'] = {
  get: {
    tags: ['Worker'],
    summary: 'The import template: ?format=xlsx (default, with a Guide sheet) or ?format=csv',
    parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['xlsx', 'csv'] } }],
    responses: { '200': { description: 'The template file' } },
  },
};
docsPaths['/workers/import'] = {
  post: {
    tags: ['Worker'],
    summary: 'Import workers from an .xlsx or .csv file (multipart field `file`). All rows or none.',
    requestBody: {
      content: {
        'multipart/form-data': {
          schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
        },
      },
    },
    responses: {
      '201': { description: '{ imported, workers: [{ id, workerId, workerName }] }' },
      '400': { description: 'error.fields: `file`, or `rows.<row>.<column>` for every problem' },
    },
  },
};
