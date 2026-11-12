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
import { noChangesError, sameFields, sameRows } from './unchanged.js';
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
  /**
   * Prisma model of the picked record. The field may also hold a list of ids (a JSON column): all must exist,
   * and `<ref>Name` is then the list of labels.
   */
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
  /** Values worked out from a valid row before it is saved; `before` is the saved row when it is edited. */
  compute?: (row: Record<string, unknown>, before?: Row) => Record<string, unknown>;
  /**
   * Taken only on create (RP1-75): an edit ignores the key and leaves the rows as they are, because the
   * rows have their own endpoints (each row its own approval request).
   */
  createOnly?: boolean;
  /** Approval resource of one row: each row then carries `pendingRequest` (its open request). */
  badge?: string;
  /**
   * RP1-124: the edit form's body may hold changes to these rows (`{ add, update, remove }` under `key`), so
   * the form and its rows are one save and one approval request. Rows it does not name stay as they are.
   */
  changes?: {
    key: string;
    /** Key of one row in the record's edit log (`row`). */
    history: string;
    /** One row in a request's summary (`row`, `bed`). */
    noun: string;
    /** A value that must differ between the record's rows. */
    unique?: { field: string; message: string };
    /** Checks one valid row: messages by field. */
    check?: (row: Record<string, unknown>) => Record<string, string>;
  };
}

/** Rows to change, checked and ready to write. */
interface RowChanges {
  add: Record<string, unknown>[];
  update: { id: string; values: Record<string, unknown>; before: Row }[];
  remove: Row[];
}
interface FileEntry {
  kind: string;
  fileId: string;
  name: string;
}
/** One edit's changes to child rows (by child key) and files. */
interface Changes {
  rows: Record<string, RowChanges>;
  files: { add: FileEntry[]; remove: FileEntry[] };
}
const noChanges = (): Changes => ({ rows: {}, files: { add: [], remove: [] } });
const asList = (v: unknown): unknown[] | null => (v === undefined ? [] : Array.isArray(v) ? v : null);
const idsIn = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const countText = (n: number, noun: string, verb: string) =>
  n ? `${n} ${noun}${n === 1 ? '' : 's'} ${verb}` : '';

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
   * RP1-124: the edit form's body may hold changes to these file lists, as
   * `{ [kind]: { add: [ids], remove: [ids] } }` under `key`, in the same save as the form.
   */
  fileChanges?: { key: string; kinds: Record<string, string> };
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
  onSave?: (data: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
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

/** A value as it is compared for "must differ": trimmed, any letter case. */
const plain = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim().toLowerCase() : '';

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
      const ids = [
        ...new Set(
          rows
            .flatMap((r): unknown[] => (Array.isArray(r[key]) ? (r[key] as unknown[]) : [r[key]]))
            .filter((v) => typeof v === 'string'),
        ),
      ] as string[];
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
      for (const r of out)
        r[`${key}Name`] = Array.isArray(r[key])
          ? (r[key] as unknown[]).map((id) => (typeof id === 'string' ? (names.get(id) ?? null) : null))
          : typeof r[key] === 'string'
            ? (names.get(r[key]) ?? null)
            : null;
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

  /** One child row: its values, or its messages added to `invalid` under `path`. */
  function parseChild(
    child: ChildConfig,
    raw: unknown,
    path: string,
    invalid: Record<string, string>,
    before?: Row,
  ) {
    const one = child.schema.safeParse(raw);
    if (!one.success) {
      for (const [key, message] of Object.entries(zodFields(one.error)))
        invalid[`${path}.${key}`] ??= message;
      return null;
    }
    const row = child.compute ? child.compute(one.data, before) : one.data;
    const problems = child.changes?.check?.(row) ?? {};
    for (const [key, message] of Object.entries(problems)) invalid[`${path}.${key}`] ??= message;
    return Object.keys(problems).length ? null : row;
  }

  /** RP1-124: reads `{ add, update, remove }` of each child; ids must be rows of this record. */
  async function parseRowChanges(
    input: Record<string, unknown>,
    id: string,
    invalid: Record<string, string>,
    out: Changes,
  ) {
    for (const child of children) {
      const config = child.changes;
      const given = config ? input[config.key] : undefined;
      if (!config || given === undefined || given === null) continue;
      const lists = given as { add?: unknown; update?: unknown; remove?: unknown };
      const add = asList(lists.add);
      const update = asList(lists.update);
      const remove = asList(lists.remove);
      if (!add || !update || !remove || typeof given !== 'object') {
        invalid[config.key] = 'Use add, update and remove lists.';
        continue;
      }
      const saved = await delegate(db, child.model).findMany({ where: { [child.parentKey]: id } });
      const byId = new Map(saved.map((r) => [r.id, r]));
      const result: RowChanges = { add: [], update: [], remove: [] };
      const touched = new Set<string>();
      const known = (rowId: unknown, path: string) => {
        const row = typeof rowId === 'string' ? byId.get(rowId) : undefined;
        if (!row) invalid[path] = 'This row no longer exists.';
        else if (touched.has(row.id)) invalid[path] = 'This row is changed twice.';
        else {
          touched.add(row.id);
          return row;
        }
        return null;
      };
      remove.forEach((rowId, i) => {
        const row = known(rowId, `${config.key}.remove.${i}`);
        if (row) result.remove.push(row);
      });
      update.forEach((raw, i) => {
        const path = `${config.key}.update.${i}`;
        const row = known((raw as { id?: unknown } | null)?.id, `${path}.id`);
        if (!row) return;
        const values = parseChild(child, raw, path, invalid, row);
        if (values) result.update.push({ id: row.id, values, before: row });
      });
      add.forEach((raw, i) => {
        const values = parseChild(child, raw, `${config.key}.add.${i}`, invalid);
        if (values) result.add.push(values);
      });
      if (config.unique) {
        const { field, message } = config.unique;
        const seen = new Set(saved.filter((r) => !touched.has(r.id)).map((r) => plain(r[field])));
        const claim = (value: unknown, path: string) => {
          if (seen.has(plain(value))) invalid[path] ??= message;
          seen.add(plain(value));
        };
        update.forEach((raw, i) =>
          claim((raw as Record<string, unknown> | null)?.[field], `${config.key}.update.${i}.${field}`),
        );
        add.forEach((raw, i) =>
          claim((raw as Record<string, unknown> | null)?.[field], `${config.key}.add.${i}.${field}`),
        );
      }
      out.rows[child.key] = result;
    }
  }

  /** RP1-124: reads `{ [kind]: { add, remove } }`; added files must exist, removed ones be on the record. */
  async function parseFileChanges(
    input: Record<string, unknown>,
    id: string,
    invalid: Record<string, string>,
    out: Changes,
  ) {
    const config = cfg.fileChanges;
    const given = config ? input[config.key] : undefined;
    if (!config || given === undefined || given === null) return;
    const row = await model().findFirst({ where: { id } });
    const asked: { kind: string; fileId: string; path: string; adding: boolean }[] = [];
    for (const kind of Object.keys(config.kinds)) {
      const lists = (given as Record<string, { add?: unknown; remove?: unknown } | undefined>)[kind];
      const add = asList(lists?.add);
      const remove = asList(lists?.remove);
      if (!add || !remove) {
        invalid[`${config.key}.${kind}`] = 'Use add and remove lists.';
        continue;
      }
      const onRecord = idsIn(row?.[kind]);
      add.forEach((fileId, i) => {
        const path = `${config.key}.${kind}.add.${i}`;
        if (typeof fileId !== 'string') invalid[path] = 'Upload the file again.';
        else if (onRecord.includes(fileId)) invalid[path] = 'This file is already on the record.';
        else asked.push({ kind, fileId, path, adding: true });
      });
      remove.forEach((fileId, i) => {
        const path = `${config.key}.${kind}.remove.${i}`;
        if (typeof fileId === 'string' && onRecord.includes(fileId))
          asked.push({ kind, fileId, path, adding: false });
        else invalid[path] = 'This file is no longer on the record.';
      });
    }
    const stored = await db.storedFile.findMany({
      where: { id: { in: asked.map((a) => a.fileId) } },
      select: { id: true, name: true },
    });
    const names = new Map(stored.map((f) => [f.id, f.name]));
    for (const { kind, fileId, path, adding } of asked) {
      const name = names.get(fileId);
      if (name === undefined) invalid[path] = 'Upload the file again.';
      else (adding ? out.files.add : out.files.remove).push({ kind, fileId, name });
    }
  }

  /** Writes one edit's row changes and logs each row on the record. */
  async function writeRowChanges(
    tx: Tx,
    parentId: string,
    changes: Changes,
    userId: string,
    approvalId: string | null,
  ) {
    const log = (key: string, oldRow: unknown, newRow: unknown) =>
      writeHistory(tx, {
        resource: cfg.name,
        recordId: parentId,
        action: 'update',
        oldData: oldRow ? { [key]: toJson(oldRow) } : undefined,
        newData: newRow ? { [key]: toJson(newRow) } : undefined,
        userId,
        approvalId,
      });
    for (const child of children) {
      const list = changes.rows[child.key];
      const config = child.changes;
      if (!list || !config) continue;
      const rows = delegate(tx, child.model);
      const shown = ({ position: _p, [child.parentKey]: _parent, ...rest }: Record<string, unknown>) => rest;
      if (list.remove.length) await rows.deleteMany({ where: { id: { in: list.remove.map((r) => r.id) } } });
      for (const row of list.remove) await log(config.history, shown(row), null);
      for (const { id, values, before } of list.update) {
        await rows.update({ where: { id }, data: values });
        await log(config.history, shown(before), { ...shown(before), ...values });
      }
      if (!list.add.length) continue;
      const last = await rows.findFirst({
        where: { [child.parentKey]: parentId },
        orderBy: { position: 'desc' },
      });
      const start = (typeof last?.position === 'number' ? last.position : -1) + 1;
      const added = list.add.map((row, i) => ({
        ...row,
        id: newId(),
        [child.parentKey]: parentId,
        position: start + i,
      }));
      await rows.createMany({ data: added });
      for (const row of added) await log(config.history, null, shown(row));
    }
  }

  /** What an approver sees of one edit's changes, under the form's keys. */
  function changeView(changes: Changes) {
    const view: Record<string, unknown> = {};
    for (const child of children) {
      const list = changes.rows[child.key];
      if (list && child.changes)
        view[child.changes.key] = {
          added: list.add,
          changed: list.update.map(({ id, values, before }) => ({ id, old: before, new: values })),
          removed: list.remove,
        };
    }
    if (cfg.fileChanges && (changes.files.add.length || changes.files.remove.length))
      view[cfg.fileChanges.key] = { added: changes.files.add, removed: changes.files.remove };
    return view;
  }

  /** ", 3 rows added, 1 row changed" for a request's summary. */
  function changeText(changes: Changes) {
    const parts: string[] = [];
    for (const child of children) {
      const list = changes.rows[child.key];
      const noun = child.changes?.noun;
      if (!list || !noun) continue;
      parts.push(
        countText(list.add.length, noun, 'added'),
        countText(list.update.length, noun, 'changed'),
        countText(list.remove.length, noun, 'removed'),
      );
    }
    for (const [kind, noun] of Object.entries(cfg.fileChanges?.kinds ?? {})) {
      const count = (files: FileEntry[]) => files.filter((f) => f.kind === kind).length;
      parts.push(
        countText(count(changes.files.add), noun, 'added'),
        countText(count(changes.files.remove), noun, 'removed'),
      );
    }
    const text = parts.filter(Boolean).join(', ');
    return text ? `, ${text}` : '';
  }

  /** Picked records that do not exist or are deleted. */
  async function refProblems(values: Record<string, unknown>) {
    const fields: Record<string, string> = {};
    for (const [key, ref] of Object.entries(cfg.refs ?? {})) {
      const v = values[key];
      // RP1-111: a list of picked records (a broker's auction centers) must all exist.
      if (Array.isArray(v)) {
        const ids = [...new Set(v.filter((x): x is string => typeof x === 'string'))];
        const found = ids.length
          ? await delegate(db, ref.model).count({ where: { id: { in: ids }, deletedAt: null } })
          : 0;
        if (found !== ids.length) fields[key] = 'Select a value from the list.';
        continue;
      }
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
        const one = parseChild(child, row, `${child.key}.${index}`, invalid);
        if (one) list.push(one);
      });
      const rule = child.changes?.unique;
      if (rule) {
        const seen = new Set<string>();
        (given ?? []).forEach((row: unknown, index: number) => {
          const value = plain((row as Record<string, unknown> | null)?.[rule.field]);
          if (value && seen.has(value)) invalid[`${child.key}.${index}.${rule.field}`] ??= rule.message;
          seen.add(value);
        });
      }
      rows[child.key] = list;
    }
    const changes = noChanges();
    if (!creating && id) {
      await parseRowChanges(input, id, invalid, changes);
      await parseFileChanges(input, id, invalid, changes);
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
    return { values, rows, changes };
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

  /** An edit that leaves the record, its rows and its files as they are (refused: nothing to approve). */
  async function unchanged(
    row: Row,
    values: Record<string, unknown>,
    rows: Record<string, unknown[]>,
    changes: Changes,
  ) {
    if (!sameFields(values, row)) return false;
    if (changes.files.add.length || changes.files.remove.length) return false;
    for (const list of Object.values(changes.rows))
      if (
        list.add.length ||
        list.remove.length ||
        list.update.some(({ values: next, before }) => !sameFields(next, before))
      )
        return false;
    for (const child of children) {
      const list = rows[child.key];
      if (!list) continue;
      const saved = await delegate(db, child.model).findMany({
        where: { [child.parentKey]: row.id },
        orderBy: { position: 'asc' },
      });
      if (!sameRows(list as Record<string, unknown>[], saved)) return false;
    }
    return true;
  }

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
  const withOnSave = async (form: Record<string, unknown>) =>
    cfg.onSave ? { ...form, ...(await cfg.onSave(form)) } : form;

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
    const values = await withOnSave(form);
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
    changes: Changes,
    done?: Done,
  ) {
    const values = await withOnSave(form);
    await db.$transaction(async (tx) => {
      const lists: Record<string, string[]> = {};
      if (changes.files.add.length || changes.files.remove.length) {
        // Read in the transaction, so a file saved meanwhile is not lost.
        const now = await delegate(tx, cfg.model).findFirst({ where: { id } });
        for (const kind of Object.keys(cfg.fileChanges?.kinds ?? {})) {
          const gone = changes.files.remove.filter((f) => f.kind === kind).map((f) => f.fileId);
          const added = changes.files.add.filter((f) => f.kind === kind).map((f) => f.fileId);
          lists[kind] = [...idsIn(now?.[kind]).filter((x) => !gone.includes(x)), ...added];
        }
      }
      await delegate(tx, cfg.model).update({
        where: { id },
        data: { ...values, ...lists, updatedBy: userId },
      });
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
      await writeRowChanges(tx, id, changes, userId, approvalId);
      for (const [entries, key] of [
        [changes.files.remove, 'oldData'],
        [changes.files.add, 'newData'],
      ] as const)
        for (const entry of entries)
          await writeHistory(tx, {
            resource: cfg.name,
            recordId: id,
            action: 'update',
            [key]: { file: entry },
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
        const { values, rows, changes } = await parseBody(request.payload, false, id);
        await applyUpdate(id, before, values, rows, by, approvalId, changes, done);
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
      const values = await withOnSave(form);
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
    const { values: form, rows, changes } = await parseBody(req.body, false, id);
    const values = await withOnSave(form);
    if (await unchanged(row, values, rows, changes)) throw noChangesError();
    if (on) {
      res.status(202).json(
        await queue(req, {
          recordId: id,
          action: 'update',
          payload: req.body,
          newData: { ...values, ...rows, ...changeView(changes) },
          oldData: before,
          recordUpdatedAt: row.updatedAt as Date,
          summary: `${await summaryOf({ ...row, ...values })}${changeText(changes)}`,
        }),
      );
      return;
    }
    await applyUpdate(id, before, form, rows, userId, null, changes);
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
