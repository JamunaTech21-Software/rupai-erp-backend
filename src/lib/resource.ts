import { type Request, Router } from 'express';

import { fileUrl } from '../modules/files/service.js';
import {
  type ChangeRequestRow,
  type ModuleKey,
  approvalOn,
  pendingBadges,
  pendingValues,
  queueRequest,
  refuseIfOpen,
  refuseIfStale,
  registerApplier,
} from './approval.js';
import { db } from './db.js';
import { zodFields } from '../middleware/error-handler.js';
import { AppError, notFound, unauthenticated } from './errors.js';
import { type ExportColumn, exportFormat, sendExport } from './export.js';
import { type Tx, readHistory, writeHistory } from './history.js';
import { newId } from './ids.js';
import { toJson } from './serialize.js';
import { z } from './validation.js';

/**
 * The common CRUD kit (RP1-9, plan.md §3). One `defineResource` call gives a page its whole API:
 *
 *   GET    /<path>                 list: search, filters, page, perPage → { data, meta }
 *   GET    /<path>/summary         summary cards (when `summary` is given)
 *   GET    /<path>/export          the list as xlsx / csv, same search and filters (when `export` is given)
 *   GET    /<path>/:id             one record, with its child rows
 *   POST   /<path>                 create → 201
 *   PUT    /<path>/:id             edit (the whole form); the old data goes to the edit log
 *   DELETE /<path>/:id             soft delete → 204
 *   POST   /<path>/:id/restore     undo a delete
 *   GET    /<path>/:id/history     the edit log
 *
 * Approval (RP1-69): when the module's approval is On, create / edit / delete / restore are checked as
 * usual and then saved as a change request → 202 `{ message, approval }`; the live data changes only when
 * the request is approved (`POST /approvals/:id/approve`, which runs the same code). Rows with an open
 * request carry `pendingRequest`.
 *
 * Body and response keys are the form's field names. A field that picks another record holds its id and
 * the response adds `<field>Name` beside it. Every table has the audit columns created/updated/deleted
 * at/by; deleted rows never show in lists.
 */

export type Row = Record<string, unknown> & { id: string };
type Where = Record<string, unknown>;
interface Delegate {
  findMany(args: object): Promise<Row[]>;
  findFirst(args: object): Promise<Row | null>;
  count(args: object): Promise<number>;
  create(args: object): Promise<Row>;
  update(args: object): Promise<Row>;
  createMany(args: object): Promise<unknown>;
  deleteMany(args: object): Promise<unknown>;
}
const delegate = (client: unknown, model: string): Delegate => {
  const d = (client as Record<string, Delegate | undefined>)[model];
  if (!d) throw new Error(`Unknown Prisma model "${model}"`);
  return d;
};

export interface RefConfig {
  /** Prisma model of the picked record. */
  model: string;
  /** Its column shown as the label (`estateName`), or columns joined by spaces (first + last name). */
  label: string | string[];
}

export interface ChildConfig {
  /** Key in the body and response (`rows`, `dependents`). */
  key: string;
  model: string;
  /** Column in the child table that holds the parent id. */
  parentKey: string;
  schema: z.ZodObject;
  /** Values worked out from a valid row before it is saved (a percentage from its counts). */
  compute?: (row: Record<string, unknown>) => Record<string, unknown>;
  /**
   * Taken only on create (RP1-75): an edit ignores the key and leaves the rows as they are, because the
   * rows have their own endpoints (each row its own approval request).
   */
  createOnly?: boolean;
  /** Approval resource of one row: each row then carries `pendingRequest` (its open request). */
  badge?: string;
}

export interface ResourceConfig {
  /** Name in the edit log (`estate`). */
  name: string;
  /** For messages: "Estate not found." */
  label: string;
  /** Approval Dashboard module (RP1-69). */
  module: ModuleKey;
  /** Page name in the request's Record Details ("Estate Profile"). */
  page: string;
  /** The record in Record Details ("EST-001 (Jamuna Tea Estate)"), from a row as the API shows it. */
  describe: (row: Record<string, unknown>) => string;
  /** Prisma model (`estate`). */
  model: string;
  schema: z.ZodObject;
  search?: string[];
  /** More search conditions, for text held on another table (a tea grade's tea type name). */
  searchAlso?: (term: string) => Where[];
  /**
   * Query parameters. A name must equal the column of the same name; `{ name, where }` builds its own
   * condition (a filter through a parent: sections by estate).
   */
  filters?: (string | { name: string; where: (value: string) => Where })[];
  refs?: Record<string, RefConfig>;
  /** Fields holding uploaded file ids (one id or a list); checked to exist, answered with `<field>Url`. */
  files?: string[];
  /**
   * Fields taken only on create (RP1-75): an edit drops them and keeps the saved value, because they have
   * their own endpoints (a census's photos / documents).
   */
  createOnly?: string[];
  /**
   * Values that must be unique among records that are not deleted (codes). `{ field, scope }` makes it
   * unique only among records with the same scope values (a division code within its estate).
   */
  unique?: (string | { field: string; scope: string[] })[];
  /**
   * Extra checks after the fields are valid: returns messages by field (empty when all is well). `rows` holds
   * the child rows sent with the form, by child key.
   */
  check?: (
    values: Record<string, unknown>,
    id?: string,
    rows?: Record<string, unknown[]>,
  ) => Promise<Record<string, string>>;
  children?: ChildConfig[];
  /** `GET /<path>/export?format=xlsx|csv`: every row of the list's search and filters, in its order. */
  export?: { fileName: string; sheet: string; columns: ExportColumn[] };
  /** Summary cards for the same filters as the list. */
  summary?: (where: Where) => Promise<Record<string, unknown>>;
  /** Values the server fills on create (a generated code). */
  onCreate?: (data: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Values the server works out from the form on every create and update (a total read-only on the page). */
  onSave?: (data: Record<string, unknown>) => Record<string, unknown>;
  orderBy?: object;
  /** Why a record cannot be deleted (other records use it); nothing when it can. */
  deleteCheck?: (row: Row) => Promise<string | undefined>;
  /** Values worked out from the saved row and added to every answer (a map centre from a boundary). */
  extend?: (row: Row) => Record<string, unknown>;
  /**
   * Values read from other tables for a whole page of rows at once (RP1-81: a list's row counts and
   * totals), by record id. Added to every answer, the export included.
   */
  enrich?: (rows: Row[]) => Promise<Map<string, Record<string, unknown>>>;
  /** Registers `/options/<options.path>` → [{ id, value, label }]. */
  options?: { path: string; label: (row: Row) => string; filters?: string[] };
}

/** Everything registered, for the API docs (RP1-11). */
export const registry: (ResourceConfig & { path: string })[] = [];
export const optionsRouter = Router();

export const currentUserId = (req: Request): string => {
  if (!req.user) throw unauthenticated();
  return req.user.id;
};

/** The most rows one export holds. */
const EXPORT_LIMIT = 10_000;

const Paging = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  perPage: z.coerce.number().int().min(1).max(100).catch(10),
  search: z.string().trim().optional().catch(undefined),
});

const queryString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

export function defineResource(path: string, cfg: ResourceConfig): Router {
  registry.push({ ...cfg, path });
  const router = Router();
  const model = () => delegate(db, cfg.model);
  const children = cfg.children ?? [];

  /** Filters + search from the query string; deleted rows are always left out. */
  function whereFrom(query: Request['query']): Where {
    const where: Where = { deletedAt: null };
    const and: Where[] = [];
    for (const f of cfg.filters ?? []) {
      const name = typeof f === 'string' ? f : f.name;
      const v = queryString(query[name]);
      if (v === undefined) continue;
      if (typeof f === 'string') where[f] = v;
      else and.push(f.where(v));
    }
    if (and.length) where.AND = and;
    const search = queryString(query.search);
    if (search && cfg.search?.length)
      where.OR = [
        ...cfg.search.map((col) => ({ [col]: { contains: search } })),
        ...(cfg.searchAlso?.(search) ?? []),
      ];
    return where;
  }

  /** Adds `<ref>Name` labels and child rows, then formats for JSON. */
  async function present(rows: Row[], withChildren: boolean): Promise<unknown[]> {
    const out = rows.map((r) => ({ ...r }));
    for (const [key, ref] of Object.entries(cfg.refs ?? {})) {
      const ids = [...new Set(rows.map((r) => r[key]).filter((v): v is string => typeof v === 'string'))];
      if (!ids.length) {
        for (const r of out) r[`${key}Name`] = null;
        continue;
      }
      const columns = typeof ref.label === 'string' ? [ref.label] : ref.label;
      const targets = await delegate(db, ref.model).findMany({
        where: { id: { in: ids } },
        select: { id: true, ...Object.fromEntries(columns.map((c) => [c, true])) },
      });
      const names = new Map(
        targets.map((t) => [
          t.id,
          typeof ref.label === 'string'
            ? t[ref.label]
            : columns
                .map((c) => t[c])
                .filter((v) => v !== null && v !== undefined && v !== '')
                .map(String)
                .join(' '),
        ]),
      );
      for (const r of out) r[`${key}Name`] = typeof r[key] === 'string' ? (names.get(r[key]) ?? null) : null;
    }
    // Who created and last changed each record, for "Created By" on detail panels.
    const userIds = [
      ...new Set(
        rows.flatMap((r) => [r.createdBy, r.updatedBy]).filter((v): v is string => typeof v === 'string'),
      ),
    ];
    const users = new Map(
      userIds.length
        ? (await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map(
            (u) => [u.id, u.name],
          )
        : [],
    );
    for (const r of out) {
      r.createdByName = typeof r.createdBy === 'string' ? (users.get(r.createdBy) ?? null) : null;
      r.updatedByName = typeof r.updatedBy === 'string' ? (users.get(r.updatedBy) ?? null) : null;
      if (cfg.extend) Object.assign(r, cfg.extend(r));
    }
    // A file field answers with signed links (`<field>Url`); a single file also with its name (`<field>Name`).
    const singleFileIds = (cfg.files ?? []).flatMap((key) =>
      rows.map((r) => r[key]).filter((v): v is string => typeof v === 'string'),
    );
    const fileNames = new Map(
      singleFileIds.length
        ? (
            await db.storedFile.findMany({
              where: { id: { in: [...new Set(singleFileIds)] } },
              select: { id: true, name: true },
            })
          ).map((f) => [f.id, f.name])
        : [],
    );
    for (const key of cfg.files ?? [])
      for (const r of out) {
        const v = r[key];
        if (Array.isArray(v))
          r[`${key}Url`] = v.filter((x): x is string => typeof x === 'string').map(fileUrl);
        else {
          r[`${key}Url`] = typeof v === 'string' ? fileUrl(v) : null;
          r[`${key}Name`] = typeof v === 'string' ? (fileNames.get(v) ?? null) : null;
        }
      }
    if (cfg.enrich && rows.length) {
      const extra = await cfg.enrich(rows);
      for (const r of out) Object.assign(r, extra.get(r.id) ?? {});
    }
    // "Pending approval" badge: the open change request of each record (RP1-69).
    const badges = await pendingBadges(
      cfg.name,
      rows.map((r) => r.id).filter((v) => typeof v === 'string' && v !== ''),
    );
    for (const r of out) r.pendingRequest = badges.get(r.id) ?? null;
    if (withChildren)
      for (const child of children)
        for (const r of out) {
          const list = await delegate(db, child.model).findMany({
            where: { [child.parentKey]: r.id },
            orderBy: { position: 'asc' },
          });
          const rowBadges = child.badge
            ? await pendingBadges(
                child.badge,
                list.map((x) => x.id),
              )
            : null;
          r[child.key] = list.map(({ position: _p, [child.parentKey]: _parent, ...rest }) =>
            rowBadges ? { ...rest, pendingRequest: rowBadges.get(String(rest.id)) ?? null } : rest,
          );
        }
    return out.map((r) => toJson(r));
  }

  async function findLive(id: string): Promise<Row> {
    const row = await model().findFirst({ where: { id, deletedAt: null } });
    if (!row) throw notFound(cfg.label);
    return row;
  }

  /** Picked records that do not exist or are deleted. */
  async function refProblems(values: Record<string, unknown>) {
    const fields: Record<string, string> = {};
    for (const [key, ref] of Object.entries(cfg.refs ?? {})) {
      const v = values[key];
      if (typeof v !== 'string') continue;
      const exists = await delegate(db, ref.model).count({ where: { id: v, deletedAt: null } });
      if (!exists) fields[key] = 'Select a value from the list.';
    }
    return fields;
  }

  /** A restored record must not point at a deleted record or take a value that is now in use. */
  async function checkRestore(row: Row) {
    const fields = await refProblems(row);
    if (Object.keys(fields).length)
      throw new AppError('VALIDATION', 'Please correct the highlighted fields.', fields);
    await checkUnique(row, row.id);
  }

  async function checkDelete(row: Row) {
    const reason = await cfg.deleteCheck?.(row);
    if (reason) throw new AppError('DUPLICATE', reason);
  }

  /**
   * Refuses values already used by a live record or by a request waiting for approval (the record's own
   * request is left out). Also runs on restore, because a deleted record's code can be used again.
   */
  async function checkUnique(values: Record<string, unknown>, id?: string, requestRecordId?: string) {
    const fields: Record<string, string> = {};
    const waiting = cfg.unique?.length ? await pendingValues(cfg.name, requestRecordId) : [];
    for (const rule of cfg.unique ?? []) {
      const { field, scope } = typeof rule === 'string' ? { field: rule, scope: [] } : rule;
      const v = values[field];
      if (v === null || v === undefined) continue;
      const same = (a: unknown, b: unknown) =>
        JSON.stringify(toJson(a)).toLowerCase() === JSON.stringify(toJson(b)).toLowerCase();
      if (waiting.some((p) => same(p[field], v) && scope.every((k) => same(p[k], values[k])))) {
        fields[field] = 'This value is already used by a request waiting for approval.';
        continue;
      }
      const taken = await model().count({
        where: {
          [field]: v,
          ...Object.fromEntries(scope.map((k) => [k, values[k]])),
          deletedAt: null,
          ...(id ? { NOT: { id } } : {}),
        },
      });
      if (taken) fields[field] = 'This value is already used.';
    }
    if (Object.keys(fields).length) throw new AppError('DUPLICATE', 'This record already exists.', fields);
  }

  /**
   * Validates the body, then checks picked records exist and codes are unique. Keys the form does not have
   * are dropped (zod strips them), so audit columns can never be sent. Child rows left out of an edit stay
   * as they are.
   */
  async function parseBody(body: unknown, creating: boolean, id?: string, requestRecordId?: string) {
    const input = (body ?? {}) as Record<string, unknown>;
    // The form and every child row are checked together, so all mistakes come back in one answer.
    // Error keys are the form's own names: `managers.1.type`.
    const invalid: Record<string, string> = {};
    const parsed = cfg.schema.safeParse(input);
    if (!parsed.success) Object.assign(invalid, zodFields(parsed.error));
    const rows: Record<string, unknown[]> = {};
    for (const child of children) {
      const given = input[child.key];
      if ((given === undefined || child.createOnly) && !creating) continue;
      if (given !== undefined && given !== null && !Array.isArray(given)) {
        invalid[child.key] = 'Must be a list.';
        continue;
      }
      const list: unknown[] = [];
      (given ?? []).forEach((row: unknown, index: number) => {
        // react-hook-form leaves holes for fields named `rows.1.x`; they are skipped.
        if (row === null || row === undefined) return;
        const one = child.schema.safeParse(row);
        if (one.success) list.push(child.compute ? child.compute(one.data) : one.data);
        else
          for (const [key, message] of Object.entries(zodFields(one.error)))
            invalid[`${child.key}.${index}.${key}`] ??= message;
      });
      rows[child.key] = list;
    }
    if (!parsed.success || Object.keys(invalid).length)
      throw new AppError('VALIDATION', 'Please correct the highlighted fields.', invalid);
    const values = parsed.data;
    if (!creating) for (const key of cfg.createOnly ?? []) delete values[key];
    const fields: Record<string, string> = {};
    Object.assign(fields, await refProblems(values));
    for (const key of cfg.files ?? []) {
      const v = values[key];
      const ids = Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string')
        : typeof v === 'string'
          ? [v]
          : [];
      if (!ids.length) continue;
      const found = await db.storedFile.count({ where: { id: { in: ids } } });
      if (found !== new Set(ids).size) fields[key] = 'Upload the file again.';
    }
    if (Object.keys(fields).length)
      throw new AppError('VALIDATION', 'Please correct the highlighted fields.', fields);
    if (cfg.check) Object.assign(fields, await cfg.check(values, id, rows));
    if (Object.keys(fields).length)
      throw new AppError('VALIDATION', 'Please correct the highlighted fields.', fields);
    await checkUnique(values, id, requestRecordId ?? id);
    return { values, rows };
  }

  async function writeChildren(
    tx: unknown,
    parentId: string,
    rows: Record<string, unknown[]>,
    replace: boolean,
  ) {
    for (const child of children) {
      const list = rows[child.key];
      if (!list) continue;
      if (replace) await delegate(tx, child.model).deleteMany({ where: { [child.parentKey]: parentId } });
      if (list.length)
        await delegate(tx, child.model).createMany({
          data: list.map((row, position) => ({
            ...(row as object),
            id: newId(),
            [child.parentKey]: parentId,
            position,
          })),
        });
    }
  }

  const snapshot = async (row: Row) => (await present([row], true))[0];

  router.get('/', async (req, res) => {
    const { page, perPage } = Paging.parse(req.query);
    const where = whereFrom(req.query);
    const [rows, total] = await Promise.all([
      model().findMany({
        where,
        orderBy: cfg.orderBy ?? { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      model().count({ where }),
    ]);
    res.json({
      data: await present(rows, false),
      meta: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  });

  if (cfg.summary) {
    const summary = cfg.summary;
    router.get('/summary', async (req, res) => {
      res.json(toJson(await summary(whereFrom(req.query))));
    });
  }

  if (cfg.export) {
    const { fileName, sheet, columns } = cfg.export;
    router.get('/export', async (req, res) => {
      const format = exportFormat(req.query.format);
      const rows = await model().findMany({
        where: whereFrom(req.query),
        orderBy: cfg.orderBy ?? { createdAt: 'desc' },
        take: EXPORT_LIMIT,
      });
      const listed = (await present(rows, false)) as Record<string, unknown>[];
      await sendExport(res, format, { fileName, sheet, columns, rows: listed });
    });
  }

  router.get('/:id', async (req, res) => {
    res.json(await snapshot(await findLive(req.params.id)));
  });

  const applier = `resource:${cfg.name}`;
  const withOnSave = (form: Record<string, unknown>) =>
    cfg.onSave ? { ...form, ...cfg.onSave(form) } : form;

  /** Record Details: "<page> — <describe(row)>", with the ref names filled in. */
  async function summaryOf(row: Record<string, unknown>) {
    const shown = (await present([{ ...row, id: typeof row.id === 'string' ? row.id : '' }], false))[0];
    return `${cfg.page} — ${cfg.describe((shown ?? {}) as Record<string, unknown>)}`;
  }

  async function findDeleted(id: string): Promise<Row> {
    const row = await model().findFirst({ where: { id, NOT: { deletedAt: null } } });
    if (!row) throw notFound(`Deleted ${cfg.label.toLowerCase()}`);
    return row;
  }

  /** The writes of each action; `done` runs in the same transaction (marks the request approved). */
  type Done = ((tx: Tx) => Promise<void>) | undefined;
  async function applyCreate(
    id: string,
    form: Record<string, unknown>,
    rows: Record<string, unknown[]>,
    userId: string,
    approvalId: string | null,
    done?: Done,
  ) {
    const values = withOnSave(form);
    const extra = cfg.onCreate ? await cfg.onCreate(values) : {};
    await db.$transaction(async (tx) => {
      await delegate(tx, cfg.model).create({
        data: { ...values, ...extra, id, createdBy: userId, updatedBy: userId },
      });
      await writeChildren(tx, id, rows, false);
      await writeHistory(tx, {
        resource: cfg.name,
        recordId: id,
        action: 'create',
        newData: { id, ...values, ...extra, ...rows },
        userId,
        approvalId,
      });
      if (done) await done(tx);
    });
  }

  async function applyUpdate(
    id: string,
    before: unknown,
    form: Record<string, unknown>,
    rows: Record<string, unknown[]>,
    userId: string,
    approvalId: string | null,
    done?: Done,
  ) {
    const values = withOnSave(form);
    await db.$transaction(async (tx) => {
      await delegate(tx, cfg.model).update({ where: { id }, data: { ...values, updatedBy: userId } });
      await writeChildren(tx, id, rows, true);
      await writeHistory(tx, {
        resource: cfg.name,
        recordId: id,
        action: 'update',
        oldData: before,
        newData: { id, ...values, ...rows },
        userId,
        approvalId,
      });
      if (done) await done(tx);
    });
  }

  async function applyDelete(
    id: string,
    before: unknown,
    userId: string,
    approvalId: string | null,
    done?: Done,
  ) {
    await db.$transaction(async (tx) => {
      await delegate(tx, cfg.model).update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy: userId },
      });
      await writeHistory(tx, {
        resource: cfg.name,
        recordId: id,
        action: 'delete',
        oldData: before,
        userId,
        approvalId,
      });
      if (done) await done(tx);
    });
  }

  async function applyRestore(id: string, userId: string, approvalId: string | null, done?: Done) {
    await db.$transaction(async (tx) => {
      await delegate(tx, cfg.model).update({
        where: { id },
        data: { deletedAt: null, deletedBy: null, updatedBy: userId },
      });
      await writeHistory(tx, { resource: cfg.name, recordId: id, action: 'restore', userId, approvalId });
      if (done) await done(tx);
    });
  }

  /** Approval: checks the request's data again and applies it as its requester. */
  registerApplier(applier, async (request: ChangeRequestRow, done) => {
    const { recordId: id, requestedBy: by, id: approvalId } = request;
    switch (request.action) {
      case 'create': {
        const { values, rows } = await parseBody(request.payload, true, undefined, id);
        await applyCreate(id, values, rows, by, approvalId, done);
        return;
      }
      case 'update': {
        const row = await findLive(id);
        refuseIfStale(request, row);
        const before = await snapshot(row);
        const { values, rows } = await parseBody(request.payload, false, id);
        await applyUpdate(id, before, values, rows, by, approvalId, done);
        return;
      }
      case 'delete': {
        const row = await findLive(id);
        refuseIfStale(request, row);
        await checkDelete(row);
        await applyDelete(id, await snapshot(row), by, approvalId, done);
        return;
      }
      case 'restore': {
        const row = await findDeleted(id);
        refuseIfStale(request, row);
        await checkRestore(row);
        await applyRestore(id, by, approvalId, done);
        return;
      }
      default:
        throw new Error(`Unknown action "${request.action}"`);
    }
  });

  const queue = (
    req: Request,
    entry: Omit<Parameters<typeof queueRequest>[0], 'module' | 'resource' | 'page' | 'applier' | 'userId'>,
  ) =>
    queueRequest({
      ...entry,
      module: cfg.module,
      resource: cfg.name,
      page: cfg.page,
      applier,
      userId: currentUserId(req),
    });

  router.post('/', async (req, res) => {
    const userId = currentUserId(req);
    const { values: form, rows } = await parseBody(req.body, true);
    const id = newId();
    if (await approvalOn(cfg.module)) {
      const values = withOnSave(form);
      res.status(202).json(
        await queue(req, {
          recordId: id,
          action: 'create',
          payload: req.body,
          newData: { ...values, ...rows },
          summary: await summaryOf(values),
        }),
      );
      return;
    }
    await applyCreate(id, form, rows, userId, null);
    res.status(201).json(await snapshot(await findLive(id)));
  });

  router.put('/:id', async (req, res) => {
    const userId = currentUserId(req);
    const id = req.params.id;
    const row = await findLive(id);
    const on = await approvalOn(cfg.module);
    if (on) await refuseIfOpen(cfg.name, id);
    const before = await snapshot(row);
    const { values: form, rows } = await parseBody(req.body, false, id);
    if (on) {
      const values = withOnSave(form);
      res.status(202).json(
        await queue(req, {
          recordId: id,
          action: 'update',
          payload: req.body,
          newData: { ...values, ...rows },
          oldData: before,
          recordUpdatedAt: row.updatedAt as Date,
          summary: await summaryOf({ ...row, ...values }),
        }),
      );
      return;
    }
    await applyUpdate(id, before, form, rows, userId, null);
    res.json(await snapshot(await findLive(id)));
  });

  router.delete('/:id', async (req, res) => {
    const userId = currentUserId(req);
    const id = req.params.id;
    const row = await findLive(id);
    await checkDelete(row);
    const before = await snapshot(row);
    if (await approvalOn(cfg.module)) {
      await refuseIfOpen(cfg.name, id);
      res.status(202).json(
        await queue(req, {
          recordId: id,
          action: 'delete',
          oldData: before,
          recordUpdatedAt: row.updatedAt as Date,
          summary: await summaryOf(row),
        }),
      );
      return;
    }
    await applyDelete(id, before, userId, null);
    res.status(204).end();
  });

  router.post('/:id/restore', async (req, res) => {
    const userId = currentUserId(req);
    const id = req.params.id;
    const row = await findDeleted(id);
    await checkRestore(row);
    if (await approvalOn(cfg.module)) {
      await refuseIfOpen(cfg.name, id);
      res.status(202).json(
        await queue(req, {
          recordId: id,
          action: 'restore',
          oldData: (await present([row], true))[0],
          recordUpdatedAt: row.updatedAt as Date,
          summary: await summaryOf(row),
        }),
      );
      return;
    }
    await applyRestore(id, userId, null);
    res.json(await snapshot(await findLive(id)));
  });

  router.get('/:id/history', async (req, res) => {
    const exists = await model().count({ where: { id: req.params.id } });
    if (!exists) throw notFound(cfg.label);
    res.json(await readHistory(cfg.name, req.params.id));
  });

  if (cfg.options) {
    const { label, filters = [] } = cfg.options;
    optionsRouter.get(`/${cfg.options.path}`, async (req, res) => {
      const where: Where = { deletedAt: null };
      for (const f of filters) {
        const v = queryString(req.query[f]);
        if (v !== undefined) where[f] = v;
      }
      const rows = await model().findMany({ where, orderBy: cfg.orderBy ?? { createdAt: 'asc' }, take: 500 });
      res.json(rows.map((r) => ({ id: r.id, value: r.id, label: label(r) })));
    });
  }

  return router;
}
