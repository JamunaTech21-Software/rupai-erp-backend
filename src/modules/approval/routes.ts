import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import {
  ACTION_LABELS,
  type ChangeRequestRow,
  MODULES,
  type RequestAction,
  applierFor,
  approvalOn,
  markApproved,
  moduleLabel,
  requestNo,
} from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { exportFormat, sendExport } from '../../lib/export.js';
import { bool, optText } from '../../lib/fields.js';
import { writeHistory } from '../../lib/history.js';
import { currentUserId, optionsRouter } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { zodFields } from '../../middleware/error-handler.js';

/**
 * RP1-69 I.1 Approval: approve / reject one change request, and the per-module On / Off settings.
 * RP1-71 I.3: the Approval Dashboard's list, summary cards, details (old → new) and export.
 */
export const approvalsRouter = Router();
export const approvalSettingsRouter = Router();

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

async function userNames(ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((v): v is string => typeof v === 'string'))];
  const users = wanted.length
    ? await db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } })
    : [];
  return new Map(users.map((u) => [u.id, u.name]));
}

/** "totalArea" → "Total Area". */
const labelOf = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bId\b/g, 'ID');

/** Keys that are not form values (labels the API adds, audit columns, the row changes of one save). */
const SKIP =
  /^(id|createdAt|createdBy|updatedAt|updatedBy|createdByName|updatedByName|pendingRequest|step)$|(Name|Url|Changes)$/;

const shown = (v: unknown): unknown => (v === '' || v === undefined ? null : v);
const same = (a: unknown, b: unknown) => JSON.stringify(shown(a)) === JSON.stringify(shown(b));

/** The fields an edit changes: `[{ field, label, old, new }]` (lists of rows as their row count). */
export function changesOf(oldData: unknown, newData: unknown) {
  const before = (oldData ?? {}) as Record<string, unknown>;
  const after = (newData ?? {}) as Record<string, unknown>;
  const out: { field: string; label: string; old: unknown; new: unknown }[] = [];
  for (const [field, value] of Object.entries(after)) {
    if (SKIP.test(field) && !['firstName', 'lastName', 'middleName'].includes(field)) continue;
    const old = before[field];
    if (same(old, value)) continue;
    const rows = (v: unknown) => (Array.isArray(v) ? `${v.length} rows` : shown(v));
    out.push({ field, label: labelOf(field), old: rows(old), new: rows(value) });
  }
  return out;
}

/** An edit's Record Details with its first change: "Field / Block — BLK-03 (North) (Total Area 8 → 9.5)". */
function withMainChange(r: ChangeRequestRow) {
  const first = changesOf(r.oldData, r.newData)[0];
  if (!first) return r.summary;
  const v = (x: unknown) =>
    x === null || x === undefined
      ? '—'
      : typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean'
        ? String(x)
        : '…';
  return `${r.summary} (${first.label} ${v(first.old)} → ${v(first.new)})`;
}

/** One request as the dashboard shows it. */
export async function presentRequests(rows: ChangeRequestRow[]) {
  const names = await userNames(rows.flatMap((r) => [r.requestedBy, r.reviewedBy]));
  const person = (id: string | null) => (id ? { id, name: names.get(id) ?? 'Unknown' } : null);
  return rows.map((r) => ({
    id: r.id,
    requestNo: requestNo(r.seq),
    module: r.module,
    moduleLabel: moduleLabel(r.module),
    page: r.page,
    resource: r.resource,
    recordId: r.recordId,
    recordDetails: r.action === 'update' ? withMainChange(r) : r.summary,
    action: ACTION_LABELS[r.action as RequestAction] ?? r.action,
    actionKey: r.action,
    status: STATUS_LABELS[r.status] ?? r.status,
    requestedBy: person(r.requestedBy),
    requestedAt: r.requestedAt.toISOString(),
    reviewedBy: person(r.reviewedBy),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    rejectReason: r.rejectReason,
    /** Why the last approve attempt failed (the request is still pending). */
    error: r.error,
  }));
}

export async function presentOne(id: string) {
  const row = await db.changeRequest.findUnique({ where: { id } });
  if (!row) throw notFound('Request');
  const [one] = await presentRequests([row]);
  return {
    ...one,
    oldData: row.oldData,
    newData: row.newData,
    changes: row.action === 'update' ? changesOf(row.oldData, row.newData) : [],
  };
}

async function pendingRequest(id: string) {
  const row = await db.changeRequest.findUnique({ where: { id } });
  if (!row) throw notFound('Request');
  if (row.status !== 'pending') throw new AppError('DUPLICATE', `This request is already ${row.status}.`);
  return row;
}

const messageOf = (e: AppError) =>
  [e.message, ...Object.entries(e.fields ?? {}).map(([k, v]) => `${k}: ${v}`)].join(' ');

/** Applies the change as its requester; on a failure the request stays pending with the reason. */
approvalsRouter.post('/:id/approve', async (req, res) => {
  const userId = currentUserId(req);
  const request = await pendingRequest(req.params.id);
  try {
    await applierFor(request.applier)(request, markApproved(request.id, userId));
  } catch (error) {
    if (error instanceof AppError)
      await db.changeRequest.update({ where: { id: request.id }, data: { error: messageOf(error) } });
    throw error;
  }
  res.json(await presentOne(request.id));
});

const rejectSchema = z.object({ reason: optText(1000) });

approvalsRouter.post('/:id/reject', async (req, res) => {
  const userId = currentUserId(req);
  const parsed = rejectSchema.safeParse(req.body ?? {});
  if (!parsed.success)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', zodFields(parsed.error));
  const request = await pendingRequest(req.params.id);
  const { count } = await db.changeRequest.updateMany({
    where: { id: request.id, status: 'pending' },
    data: {
      status: 'rejected',
      reviewedBy: userId,
      reviewedAt: new Date(),
      rejectReason: parsed.data.reason,
    },
  });
  if (count !== 1) throw new AppError('DUPLICATE', 'This request is no longer pending.');
  res.json(await presentOne(request.id));
});

// ---- RP1-71 I.3: list, summary, export ----------------------------------------------------------------------

const ACTIONS: Record<string, string[]> = {
  entry: ['create', 'import'],
  edit: ['update'],
  delete: ['delete'],
  restore: ['restore'],
};
const STATUSES = ['pending', 'approved', 'rejected'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Where = Record<string, unknown>;
const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' && v !== 'all' ? v.trim() : undefined);

/** A bad filter is a 400 on that query key; "all" or empty means no filter. */
function filtersFrom(
  query: Record<string, unknown>,
  use: { module?: boolean; status?: boolean; action?: boolean },
) {
  const bad: Record<string, string> = {};
  const where: Where = {};
  const and: Where[] = [];
  const module = text(query.module);
  if (use.module !== false && module) {
    if (!MODULES.some((m) => m.key === module)) bad.module = 'Select a value from the list.';
    else where.module = module;
  }
  const action = text(query.action)?.toLowerCase();
  if (use.action !== false && action) {
    if (!ACTIONS[action]) bad.action = 'Use entry, edit, delete or restore.';
    else where.action = { in: ACTIONS[action] };
  }
  const status = text(query.status)?.toLowerCase();
  if (use.status !== false && status) {
    if (!STATUSES.includes(status)) bad.status = 'Use pending, approved or rejected.';
    else where.status = status;
  }
  // Requested On, whole days (Bangladesh time, UTC+6): from 00:00 to 23:59 of `to`.
  const from = text(query.from);
  const to = text(query.to);
  const range: Where = {};
  if (from) {
    if (!DAY.test(from)) bad.from = 'Use the format YYYY-MM-DD.';
    else range.gte = new Date(`${from}T00:00:00.000+06:00`);
  }
  if (to) {
    if (!DAY.test(to)) bad.to = 'Use the format YYYY-MM-DD.';
    else range.lt = new Date(new Date(`${to}T00:00:00.000+06:00`).getTime() + 86_400_000);
  }
  if (from && to && DAY.test(from) && DAY.test(to) && from > to) bad.to = 'Must not be before From.';
  if (Object.keys(range).length) where.requestedAt = range;
  // Search: Request ID (REQ-0012 or 12), module name, page or Record Details.
  const search = text(query.search);
  if (search) {
    const or: Where[] = [{ summary: { contains: search } }, { page: { contains: search } }];
    const seq = /^(req-?)?0*(\d+)$/i.exec(search);
    if (seq) or.push({ seq: Number(seq[2]) });
    const mods = MODULES.filter((m) => m.label.toLowerCase().includes(search.toLowerCase())).map(
      (m) => m.key,
    );
    if (mods.length) or.push({ module: { in: mods } });
    and.push({ OR: or });
  }
  if (Object.keys(bad).length)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', bad);
  if (and.length) where.AND = and;
  return where;
}

const Paging = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  perPage: z.coerce.number().int().min(1).max(100).catch(10),
});
const NEWEST = [{ requestedAt: 'desc' as const }, { seq: 'desc' as const }];

/**
 * Requests newest first. Only ids are sorted, then the rows are read: a request can hold thousands of rows
 * (RP1-130), and MySQL cannot sort rows that large ("Out of sort memory").
 */
async function newestRequests(where: Where, skip: number, take: number) {
  const ids = await db.changeRequest.findMany({ where, orderBy: NEWEST, skip, take, select: { id: true } });
  const rows = await db.changeRequest.findMany({ where: { id: { in: ids.map((r) => r.id) } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap(({ id }) => byId.get(id) ?? []);
}

/** Approval Requests table: newest first; module, action, status, from / to, search, paging. */
approvalsRouter.get('/', async (req, res) => {
  const { page, perPage } = Paging.parse(req.query);
  const where = filtersFrom(req.query, {});
  const [rows, total] = await Promise.all([
    newestRequests(where, (page - 1) * perPage, perPage),
    db.changeRequest.count({ where }),
  ]);
  res.json({
    data: await presentRequests(rows),
    meta: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
  });
});

const count = (where: Where) => db.changeRequest.count({ where });

/**
 * The dashboard's numbers. Status cards: the selected module and date range (any status). Entry Action
 * Summary: also the selected status. Per-module cards: the date range and status (every module).
 */
approvalsRouter.get('/summary', async (req, res) => {
  const cards = filtersFrom(req.query, { status: false, action: false });
  const actions = filtersFrom(req.query, { action: false });
  const modules = filtersFrom(req.query, { module: false, action: false });
  const [pending, approved, rejected, total, entry, edit, del, restore, byModule] = await Promise.all([
    count({ ...cards, status: 'pending' }),
    count({ ...cards, status: 'approved' }),
    count({ ...cards, status: 'rejected' }),
    count(cards),
    count({ ...actions, action: { in: ACTIONS.entry } }),
    count({ ...actions, action: { in: ACTIONS.edit } }),
    count({ ...actions, action: { in: ACTIONS.delete } }),
    count({ ...actions, action: { in: ACTIONS.restore } }),
    db.changeRequest.groupBy({ by: ['module'], where: modules, _count: { _all: true } }),
  ]);
  res.json({
    pending,
    approved,
    rejected,
    total,
    actions: { entry, edit, delete: del, restore },
    modules: MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      built: m.built,
      count: byModule.find((b) => b.module === m.key)?._count._all ?? 0,
    })),
  });
});

const EXPORT_LIMIT = 10_000;
const stamp = (iso: string) => {
  // Requested On as the dashboard shows it (Bangladesh time): 13/09/2026 10:24 AM
  const d = new Date(new Date(iso).getTime() + 6 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const h = d.getUTCHours();
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(h % 12 || 12)}:${p(d.getUTCMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
};

/** The table as xlsx / csv, same filters, newest first. */
approvalsRouter.get('/export', async (req, res) => {
  const format = exportFormat(req.query.format);
  const where = filtersFrom(req.query, {});
  const rows = await presentRequests(await newestRequests(where, 0, EXPORT_LIMIT));
  await sendExport(res, format, {
    fileName: 'approval-requests',
    sheet: 'Approval Requests',
    columns: [
      { header: 'SL', value: (_r, i) => i + 1, width: 6 },
      { header: 'Request ID', value: (r) => r.requestNo, width: 12 },
      { header: 'Module', value: (r) => r.moduleLabel, width: 24 },
      { header: 'Record Details', value: (r) => r.recordDetails, width: 60 },
      { header: 'Action', value: (r) => r.action, width: 10 },
      { header: 'Requested By', value: (r) => (r.requestedBy as { name?: string } | null)?.name, width: 20 },
      { header: 'Requested On', value: (r) => stamp(String(r.requestedAt)), width: 20 },
      { header: 'Status', value: (r) => r.status, width: 10 },
    ],
    rows,
  });
});

/** The module tabs, in the design's order. */
optionsRouter.get('/approval-modules', (_req, res) => {
  res.json(MODULES.map((m) => ({ id: m.key, value: m.key, label: m.label, built: m.built })));
});

approvalsRouter.get('/:id', async (req, res) => {
  res.json(await presentOne(req.params.id));
});

/** Every design module with its switch, whether it is built, and its open requests. */
async function settingsList() {
  const [saved, pending] = await Promise.all([
    db.approvalSetting.findMany(),
    db.changeRequest.groupBy({ by: ['module'], where: { status: 'pending' }, _count: { _all: true } }),
  ]);
  const byModule = new Map(saved.map((s) => [s.module, s]));
  const names = await userNames(saved.map((s) => s.updatedBy));
  return MODULES.map((m) => {
    const s = byModule.get(m.key);
    return {
      module: m.key,
      label: m.label,
      built: m.built,
      enabled: s ? s.enabled : m.built,
      pending: pending.find((p) => p.module === m.key)?._count._all ?? 0,
      updatedAt: s?.updatedAt.toISOString() ?? null,
      updatedBy: s?.updatedBy ? { id: s.updatedBy, name: names.get(s.updatedBy) ?? 'Unknown' } : null,
    };
  });
}

approvalSettingsRouter.get('/', async (_req, res) => {
  res.json(await settingsList());
});

const settingSchema = z.object({
  enabled: bool().refine((v) => v !== null, 'Choose On or Off.'),
});

/** Turns approval On / Off for one module; the change is in the edit log (`approvalSetting`). */
approvalSettingsRouter.put('/:module', async (req, res) => {
  const userId = currentUserId(req);
  const module = MODULES.find((m) => m.key === req.params.module);
  if (!module) throw notFound('Module');
  const parsed = settingSchema.safeParse(req.body ?? {});
  if (!parsed.success)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', zodFields(parsed.error));
  if (!module.built)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', {
      enabled: `${module.label} is not built yet.`,
    });
  const enabled = parsed.data.enabled === true;
  const before = await db.approvalSetting.findUnique({ where: { module: module.key } });
  // Already set that way: nothing is saved or logged.
  if (enabled === (await approvalOn(module.key))) {
    res.json((await settingsList()).find((s) => s.module === module.key));
    return;
  }
  await db.$transaction(async (tx) => {
    await tx.approvalSetting.upsert({
      where: { module: module.key },
      create: { module: module.key, enabled, updatedBy: userId },
      update: { enabled, updatedBy: userId },
    });
    await writeHistory(tx, {
      resource: 'approvalSetting',
      recordId: module.key,
      action: before ? 'update' : 'create',
      oldData: before ? { module: module.key, enabled: before.enabled } : undefined,
      newData: { module: module.key, enabled },
      userId,
    });
  });
  res.json((await settingsList()).find((s) => s.module === module.key));
});

// API docs
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
const tags = ['Approval'];
const q = (name: string, description: string) => ({
  name,
  in: 'query',
  schema: { type: 'string' },
  description,
});
const listFilters = [
  q('module', 'estate | plantation | hr | … (or all)'),
  q('action', 'entry | edit | delete | restore'),
  q('status', 'pending | approved | rejected'),
  q('from', 'Requested on or after, YYYY-MM-DD'),
  q('to', 'Requested on or before, YYYY-MM-DD'),
  q('search', 'Request ID, module, page or Record Details'),
];
docsPaths['/approvals'] = {
  get: {
    tags,
    summary: 'Approval Requests table (newest first)',
    parameters: [...listFilters, q('page', '1-based'), q('perPage', '1–100, default 10')],
    responses: { '200': { description: '{ data: [request], meta }' }, '400': { description: 'Bad filter' } },
  },
};
docsPaths['/approvals/summary'] = {
  get: {
    tags,
    summary:
      'Cards: pending / approved / rejected / total, actions { entry, edit, delete, restore }, modules [{ key, label, count }]',
    parameters: listFilters.slice(0, 5),
    responses: { '200': { description: 'Summary' } },
  },
};
docsPaths['/approvals/export'] = {
  get: {
    tags,
    summary:
      'Export the table (SL, Request ID, Module, Record Details, Action, Requested By, Requested On, Status)',
    parameters: [q('format', 'xlsx (default) or csv'), ...listFilters],
    responses: { '200': { description: 'The file (attachment)' } },
  },
};
docsPaths['/options/approval-modules'] = {
  get: {
    tags: ['Dropdown options'],
    summary: 'Approval module tabs',
    responses: { '200': { description: 'Options' } },
  },
};
docsPaths['/approvals/{id}'] = {
  get: {
    tags,
    summary: 'One change request: old / new data and `changes: [{ field, label, old, new }]` (edits)',
    parameters: [idParam],
    responses: { '200': { description: 'Request' }, '404': { description: 'Not found' } },
  },
};
docsPaths['/approvals/{id}/approve'] = {
  post: {
    tags,
    summary: 'Approve: applies the change (as its requester) and writes the edit log',
    parameters: [idParam],
    responses: {
      '200': { description: 'The approved request' },
      '400': { description: 'The data no longer passes the checks (request stays pending, `error` set)' },
      '404': { description: 'Request (or its record) not found' },
      '409': { description: 'Not pending, or the record changed after the request (stale)' },
    },
  },
};
docsPaths['/approvals/{id}/reject'] = {
  post: {
    tags,
    summary: 'Reject: nothing changes; optional { reason }',
    parameters: [idParam],
    responses: { '200': { description: 'The rejected request' }, '409': { description: 'Not pending' } },
  },
};
docsPaths['/approval-settings'] = {
  get: {
    tags,
    summary: 'Approval On / Off per module',
    responses: {
      '200': { description: '[{ module, label, built, enabled, pending, updatedAt, updatedBy }]' },
    },
  },
};
docsPaths['/approval-settings/{module}'] = {
  put: {
    tags,
    summary: 'Turn approval On / Off for a module: { enabled }',
    parameters: [{ name: 'module', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': { description: 'The setting' },
      '400': { description: 'enabled missing, or the module is not built yet' },
      '404': { description: 'Unknown module' },
    },
  },
};
