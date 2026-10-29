import { type Request, Router } from 'express';

import { fileUrl } from '../modules/files/service.js';
import { db } from './db.js';
import { zodFields } from '../middleware/error-handler.js';
import { AppError, notFound, unauthenticated } from './errors.js';
import { readHistory, writeHistory } from './history.js';
import { newId } from './ids.js';
import { toJson } from './serialize.js';
import { z } from './validation.js';

/**
 * The common CRUD kit (RP1-9, plan.md §3). One `defineResource` call gives a page its whole API:
 *
 *   GET    /<path>                 list: search, filters, page, perPage → { data, meta }
 *   GET    /<path>/summary         summary cards (when `summary` is given)
 *   GET    /<path>/:id             one record, with its child rows
 *   POST   /<path>                 create → 201
 *   PUT    /<path>/:id             edit (the whole form); the old data goes to the edit log
 *   DELETE /<path>/:id             soft delete → 204
 *   POST   /<path>/:id/restore     undo a delete
 *   GET    /<path>/:id/history     the edit log
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
}

export interface ResourceConfig {
  /** Name in the edit log (`estate`). */
  name: string;
  /** For messages: "Estate not found." */
  label: string;
  /** Prisma model (`estate`). */
  model: string;
  schema: z.ZodObject;
  search?: string[];
  /**
   * Query parameters. A name must equal the column of the same name; `{ name, where }` builds its own
   * condition (a filter through a parent: sections by estate).
   */
  filters?: (string | { name: string; where: (value: string) => Where })[];
  refs?: Record<string, RefConfig>;
  /** Fields holding uploaded file ids (one id or a list); checked to exist, answered with `<field>Url`. */
  files?: string[];
  /**
   * Values that must be unique among records that are not deleted (codes). `{ field, scope }` makes it
   * unique only among records with the same scope values (a division code within its estate).
   */
  unique?: (string | { field: string; scope: string[] })[];
  /** Extra checks after the fields are valid: returns messages by field (empty when all is well). */
  check?: (values: Record<string, unknown>, id?: string) => Promise<Record<string, string>>;
  children?: ChildConfig[];
  /** Summary cards for the same filters as the list. */
  summary?: (where: Where) => Promise<Record<string, unknown>>;
  /** Values the server fills on create (a generated code). */
  onCreate?: (data: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Values the server works out from the form on every create and update (a total read-only on the page). */
  onSave?: (data: Record<string, unknown>) => Record<string, unknown>;
  orderBy?: object;
  /** Values worked out from the saved row and added to every answer (a map centre from a boundary). */
  extend?: (row: Row) => Record<string, unknown>;
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
    if (search && cfg.search?.length) where.OR = cfg.search.map((col) => ({ [col]: { contains: search } }));
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
    if (withChildren)
      for (const child of children)
        for (const r of out)
          r[child.key] = (
            await delegate(db, child.model).findMany({
              where: { [child.parentKey]: r.id },
              orderBy: { position: 'asc' },
            })
          ).map(({ position: _p, [child.parentKey]: _parent, ...rest }) => rest);
    return out.map((r) => toJson(r));
  }

  async function findLive(id: string): Promise<Row> {
    const row = await model().findFirst({ where: { id, deletedAt: null } });
    if (!row) throw notFound(cfg.label);
    return row;
  }

  /**
   * Validates the body, then checks picked records exist and codes are unique. Keys the form does not have
   * are dropped (zod strips them), so audit columns can never be sent. Child rows left out of an edit stay
   * as they are.
   */
  async function parseBody(body: unknown, creating: boolean, id?: string) {
    const input = (body ?? {}) as Record<string, unknown>;
    // The form and every child row are checked together, so all mistakes come back in one answer.
    // Error keys are the form's own names: `managers.1.type`.
    const invalid: Record<string, string> = {};
    const parsed = cfg.schema.safeParse(input);
    if (!parsed.success) Object.assign(invalid, zodFields(parsed.error));
    const rows: Record<string, unknown[]> = {};
    for (const child of children) {
      const given = input[child.key];
      if (given === undefined && !creating) continue;
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
    const fields: Record<string, string> = {};
    for (const [key, ref] of Object.entries(cfg.refs ?? {})) {
      const v = values[key];
      if (typeof v !== 'string') continue;
      const exists = await delegate(db, ref.model).count({ where: { id: v, deletedAt: null } });
      if (!exists) fields[key] = 'Select a value from the list.';
    }
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
    if (cfg.check) Object.assign(fields, await cfg.check(values, id));
    if (Object.keys(fields).length)
      throw new AppError('VALIDATION', 'Please correct the highlighted fields.', fields);
    for (const rule of cfg.unique ?? []) {
      const { field, scope } = typeof rule === 'string' ? { field: rule, scope: [] } : rule;
      const v = values[field];
      if (v === null || v === undefined) continue;
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

  router.get('/:id', async (req, res) => {
    res.json(await snapshot(await findLive(req.params.id)));
  });

  router.post('/', async (req, res) => {
    const userId = currentUserId(req);
    const { values: form, rows } = await parseBody(req.body, true);
    const values = cfg.onSave ? { ...form, ...cfg.onSave(form) } : form;
    const extra = cfg.onCreate ? await cfg.onCreate(values) : {};
    const id = newId();
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
      });
    });
    res.status(201).json(await snapshot(await findLive(id)));
  });

  router.put('/:id', async (req, res) => {
    const userId = currentUserId(req);
    const id = req.params.id;
    const before = await snapshot(await findLive(id));
    const { values: form, rows } = await parseBody(req.body, false, id);
    const values = cfg.onSave ? { ...form, ...cfg.onSave(form) } : form;
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
      });
    });
    res.json(await snapshot(await findLive(id)));
  });

  router.delete('/:id', async (req, res) => {
    const userId = currentUserId(req);
    const before = await snapshot(await findLive(req.params.id));
    await db.$transaction(async (tx) => {
      await delegate(tx, cfg.model).update({
        where: { id: req.params.id },
        data: { deletedAt: new Date(), deletedBy: userId },
      });
      await writeHistory(tx, {
        resource: cfg.name,
        recordId: req.params.id,
        action: 'delete',
        oldData: before,
        userId,
      });
    });
    res.status(204).end();
  });

  router.post('/:id/restore', async (req, res) => {
    const userId = currentUserId(req);
    const row = await model().findFirst({ where: { id: req.params.id, NOT: { deletedAt: null } } });
    if (!row) throw notFound(`Deleted ${cfg.label.toLowerCase()}`);
    await db.$transaction(async (tx) => {
      await delegate(tx, cfg.model).update({
        where: { id: req.params.id },
        data: { deletedAt: null, deletedBy: null, updatedBy: userId },
      });
      await writeHistory(tx, { resource: cfg.name, recordId: req.params.id, action: 'restore', userId });
    });
    res.json(await snapshot(await findLive(req.params.id)));
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
