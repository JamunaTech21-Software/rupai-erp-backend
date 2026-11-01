import type { Prisma } from '../generated/prisma/client.js';
import { db } from './db.js';
import { AppError } from './errors.js';
import type { Tx } from './history.js';
import { newId } from './ids.js';
import { toJson } from './serialize.js';

/**
 * RP1-69 I.1 Approval (maker-checker). A create, edit, delete or restore in a module whose approval is On
 * is saved as a change request; it changes the live data only when someone approves it.
 */

/** The Approval Dashboard's module tabs, in the design's order; Plantation is added because it is built. */
export const MODULES = [
  { key: 'estate', label: 'Estate Management', built: true },
  { key: 'plantation', label: 'Plantation Management', built: true },
  { key: 'hr', label: 'HR & Labour Management', built: true },
  { key: 'production', label: 'Production Management', built: false },
  { key: 'factory', label: 'Factory Management', built: false },
  { key: 'sales', label: 'Sales & Accounts', built: false },
  { key: 'inventory', label: 'Inventory Management', built: false },
  { key: 'reports', label: 'Reports & Analytics', built: false },
  { key: 'system', label: 'System Administration', built: false },
] as const;
export type ModuleKey = (typeof MODULES)[number]['key'];
export const MODULE_KEYS = MODULES.map((m) => m.key) as readonly string[];
export const moduleLabel = (key: string) => MODULES.find((m) => m.key === key)?.label ?? key;

export type RequestAction = 'create' | 'update' | 'delete' | 'restore' | 'import';
/** How the dashboard names each action. */
export const ACTION_LABELS: Record<RequestAction, string> = {
  create: 'Entry',
  update: 'Edit',
  delete: 'Delete',
  restore: 'Restore',
  import: 'Entry',
};

export const requestNo = (seq: number) => `REQ-${String(seq).padStart(4, '0')}`;

/** Is approval On for this module? A module with no saved setting is On when it is built. */
export async function approvalOn(module: ModuleKey): Promise<boolean> {
  const row = await db.approvalSetting.findUnique({ where: { module } });
  return row ? row.enabled : (MODULES.find((m) => m.key === module)?.built ?? false);
}

export type ChangeRequestRow = Awaited<ReturnType<typeof db.changeRequest.findFirstOrThrow>>;

/**
 * Applies an approved request. It re-checks the data, runs its writes and then `done(tx)` (which marks the
 * request approved) in one transaction, and throws an AppError when the request can no longer be applied.
 */
export type Applier = (request: ChangeRequestRow, done: (tx: Tx) => Promise<void>) => Promise<void>;
const appliers = new Map<string, Applier>();

export function registerApplier(key: string, apply: Applier) {
  if (appliers.has(key)) throw new Error(`Applier "${key}" is registered twice`);
  appliers.set(key, apply);
}

export function applierFor(key: string): Applier {
  const apply = appliers.get(key);
  if (!apply) throw new Error(`No applier "${key}"`);
  return apply;
}

/** The open request of one record, if any. */
export const openRequest = (resource: string, recordId: string) =>
  db.changeRequest.findFirst({ where: { resource, recordId, status: 'pending' } });

/** 409 when the record already waits for approval: one open request per record. */
export async function refuseIfOpen(resource: string, recordId: string) {
  const open = await openRequest(resource, recordId);
  if (open)
    throw new AppError('DUPLICATE', `This record already has a pending request (${requestNo(open.seq)}).`);
}

export interface PendingBadge {
  id: string;
  requestNo: string;
  action: string;
}

/** `pendingRequest` for each record id that has an open request (the lists' "Pending approval" badge). */
export async function pendingBadges(resource: string, ids: string[]): Promise<Map<string, PendingBadge>> {
  if (!ids.length) return new Map();
  const open = await db.changeRequest.findMany({
    where: { resource, recordId: { in: ids }, status: 'pending' },
    select: { id: true, seq: true, action: true, recordId: true },
  });
  return new Map(open.map((r) => [r.recordId, { id: r.id, requestNo: requestNo(r.seq), action: r.action }]));
}

/**
 * The checked values of the other pending creates / edits of a resource (for "unique among records",
 * which now also counts values waiting for approval). `exceptRecordId` leaves out the record's own request.
 */
export async function pendingValues(resource: string, exceptRecordId?: string) {
  const open = await db.changeRequest.findMany({
    where: {
      resource,
      status: 'pending',
      action: { in: ['create', 'update'] },
      ...(exceptRecordId ? { NOT: { recordId: exceptRecordId } } : {}),
    },
    select: { newData: true },
  });
  return open.map((r) => (r.newData ?? {}) as Record<string, unknown>);
}

/** Saves a request and answers what the API returns with its 202. */
export async function queueRequest(entry: {
  module: ModuleKey;
  resource: string;
  page: string;
  applier: string;
  recordId: string;
  action: RequestAction;
  payload?: unknown;
  newData?: unknown;
  oldData?: unknown;
  recordUpdatedAt?: Date | null;
  summary: string;
  userId: string;
}) {
  const json = (v: unknown) => (v === undefined ? undefined : toJson(v)) as Prisma.InputJsonValue | undefined;
  const row = await db.changeRequest.create({
    data: {
      id: newId(),
      module: entry.module,
      resource: entry.resource,
      page: entry.page,
      applier: entry.applier,
      recordId: entry.recordId,
      action: entry.action,
      // The body exactly as sent (dates stay "YYYY-MM-DD"), so approval can check it again.
      payload: entry.payload as Prisma.InputJsonValue | undefined,
      newData: json(entry.newData),
      oldData: json(entry.oldData),
      recordUpdatedAt: entry.recordUpdatedAt ?? null,
      summary: entry.summary.slice(0, 500),
      requestedBy: entry.userId,
    },
  });
  return {
    message: 'Sent for approval',
    approval: {
      id: row.id,
      requestNo: requestNo(row.seq),
      module: row.module,
      action: ACTION_LABELS[entry.action],
      status: 'Pending',
    },
  };
}

/** 409 when the record changed after the request was made (another edit was approved or saved since). */
export function refuseIfStale(request: ChangeRequestRow, current: Record<string, unknown>) {
  const was = request.recordUpdatedAt?.getTime();
  const now = current.updatedAt instanceof Date ? current.updatedAt.getTime() : undefined;
  if (was !== undefined && now !== undefined && was !== now)
    throw new AppError(
      'DUPLICATE',
      'The record changed after this request was made. Reject it and send the change again.',
    );
}

/** Marks a request approved by `userId`, inside the transaction that applied it. */
export const markApproved = (requestId: string, userId: string) => async (tx: Tx) => {
  // Only a request that is still pending: a second, simultaneous approve rolls back.
  const { count } = await tx.changeRequest.updateMany({
    where: { id: requestId, status: 'pending' },
    data: { status: 'approved', reviewedBy: userId, reviewedAt: new Date(), error: null },
  });
  if (count !== 1) throw new AppError('DUPLICATE', 'This request is no longer pending.');
};

/** Joins the given values for Record Details, skipping empty ones: `show('EST-001', '(Jamuna)')`. */
export const show = (...parts: unknown[]) =>
  parts
    .filter((p) => p !== null && p !== undefined && p !== '' && p !== '()')
    .map((p) => (typeof p === 'string' || typeof p === 'number' ? String(p) : ''))
    .join(' ');

/** "(value)", or nothing when the value is empty. */
export const paren = (v: unknown) =>
  typeof v === 'string' || typeof v === 'number' ? (String(v) === '' ? '' : `(${String(v)})`) : '';

// ---------------------------------------------------------------------------------------------
// RP1-70 I.2: writes that are not CRUD-kit resources (nursery beds / stock, bush-register rows,
// replanting steps, the worker import) go through the same approval with a "custom write".
// ---------------------------------------------------------------------------------------------

/** What a custom write's check returns: the record, its Record Details, and the writes to run. */
export interface CustomPlan {
  /** The row changed (for a create, the id it will get). */
  recordId: string;
  /** Record Details after the page name: "Central Nursery: Bed NB-007 (North Bed)". */
  summary: string;
  /** The row before (null for a create). On approval it must still be the same, or the request is stale. */
  oldData: unknown;
  newData?: unknown;
  /** The writes, in the caller's transaction, as `userId`; `approvalId` goes to the edit log. */
  run: (tx: Tx, userId: string, approvalId: string | null) => Promise<unknown>;
}

export interface CustomInput {
  params: Record<string, string>;
  body: unknown;
  action: RequestAction;
  /** The id reserved for a create (set again on approval, so the record gets the same id). */
  recordId?: string;
}

export interface CustomWrite {
  key: string;
  module: ModuleKey;
  /** Name used for the badges and "one open request per row" (nurseryBed, bushRegisterRow, …). */
  resource: string;
  page: string;
  /** Checks the input (throws an AppError) and plans the writes. Runs again on approval. */
  plan: (input: CustomInput) => Promise<CustomPlan>;
}

/** JSON with keys sorted, so a snapshot read back from a JSON column compares equal. */
function stableJson(value: unknown): string {
  const v = toJson(value);
  const sort = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(sort)
      : x && typeof x === 'object'
        ? Object.fromEntries(
            Object.entries(x as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, val]) => [k, sort(val)]),
          )
        : x;
  return JSON.stringify(sort(v));
}

interface StoredInput {
  params: Record<string, string>;
  body: unknown;
  recordId?: string;
}

/** Registers a custom write's applier; use `runCustomWrite` in its routes. */
export function defineCustomWrite(def: CustomWrite): CustomWrite {
  registerApplier(`custom:${def.key}`, async (request, done) => {
    const stored = (request.payload ?? {}) as unknown as StoredInput;
    const plan = await def.plan({
      params: stored.params ?? {},
      body: stored.body,
      action: request.action as RequestAction,
      recordId: stored.recordId,
    });
    if (stableJson(plan.oldData ?? null) !== stableJson(request.oldData ?? null))
      throw new AppError(
        'DUPLICATE',
        'The record changed after this request was made. Reject it and send the change again.',
      );
    await db.$transaction(
      async (tx) => {
        await plan.run(tx, request.requestedBy, request.id);
        await done(tx);
      },
      { timeout: 120_000 },
    );
  });
  return def;
}

/**
 * Runs a custom write from its route: with the module's approval On it is queued (the 202 answer is
 * returned), otherwise it is applied now and `null` comes back, so the route answers as it always did.
 */
export async function runCustomWrite(
  def: CustomWrite,
  input: Omit<CustomInput, 'recordId'> & { payload?: { params: Record<string, string>; body: unknown } },
  userId: string,
) {
  const plan = await def.plan({ params: input.params, body: input.body, action: input.action });
  if (await approvalOn(def.module)) {
    if (input.action !== 'create' && input.action !== 'import')
      await refuseIfOpen(def.resource, plan.recordId);
    const stored: StoredInput = {
      ...(input.payload ?? { params: input.params, body: input.body }),
      recordId: plan.recordId,
    };
    return {
      queued: await queueRequest({
        module: def.module,
        resource: def.resource,
        page: def.page,
        applier: `custom:${def.key}`,
        recordId: plan.recordId,
        action: input.action,
        payload: stored,
        newData: plan.newData,
        oldData: plan.oldData ?? undefined,
        summary: `${def.page} — ${plan.summary}`,
        userId,
      }),
      plan,
      result: undefined,
    };
  }
  const result = await db.$transaction((tx) => plan.run(tx, userId, null), { timeout: 120_000 });
  return { queued: null, plan, result };
}
