import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { type Tx, writeHistory } from '../../lib/history.js';
import { newId } from '../../lib/ids.js';
import { currentUserId } from '../../lib/resource.js';
import { budgetSettings } from './settings.js';

/**
 * RP1-243 the budget workflow, shared by every budget document (annual budget now; department budget, monthly
 * allocation, revision and transfer register themselves later). Submit for Approval takes the Required levels of
 * Budget Settings in their order; each level then Approves (the last one makes the document Approved), Rejects
 * (final), Returns (back to the preparer to edit and submit again) or Requests Info (stays at the level; anyone
 * can Reply). No user roles in Phase 1, so any signed-in user can act on the current level (decision 2026-11-26).
 * Every step is logged (`budget_workflow_logs`) and in the document's edit log.
 */
export const STATUSES = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'RETURNED', label: 'Returned' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];
export const statusLabel = (v: unknown) => STATUSES.find((s) => s.value === v)?.label ?? null;
/** Statuses the preparer can still edit (and delete). */
export const EDITABLE = ['DRAFT', 'RETURNED'];

const ACTIONS: Record<string, string> = {
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RETURNED: 'Returned',
  INFO_REQUESTED: 'Info Requested',
  INFO_REPLIED: 'Info Replied',
};

export type Level = { key: string; name: string; role: string };
/** The workflow columns every budget document has. */
export interface WorkflowRow {
  id: string;
  status: string;
  workflowLevels: unknown;
  currentStep: number | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  createdBy: string;
  deletedAt: Date | null;
}
type State = Pick<WorkflowRow, 'status' | 'workflowLevels' | 'currentStep' | 'submittedAt' | 'decidedAt'>;

export interface WorkflowDoc {
  /** ANNUAL_BUDGET, DEPARTMENT_BUDGET, ALLOCATION, REVISION, TRANSFER. */
  docType: string;
  label: string;
  /** Edit-log resource of the document. */
  resource: string;
  find: (id: string) => Promise<(WorkflowRow & Record<string, unknown>) | null>;
  /**
   * Moves the state only when it is still `from` (two clicks at once cannot both act); returns rows changed. It
   * must always change the row (set updatedAt), as Request Info and Reply keep the status.
   */
  update: (tx: Tx, id: string, from: State, data: Partial<State>) => Promise<number>;
  code: (row: Record<string, unknown>) => string;
  /** Why it cannot be submitted yet (no lines, over a limit); nothing when it can. */
  canSubmit?: (row: Record<string, unknown>) => Promise<string | undefined>;
  /** Runs in the same transaction when the last level approves. */
  onApproved?: (tx: Tx, row: Record<string, unknown>, userId: string) => Promise<void>;
}
const DOCS = new Map<string, WorkflowDoc>();
export function registerWorkflowDoc(doc: WorkflowDoc) {
  DOCS.set(doc.docType, doc);
}
export const workflowDoc = (docType: string) => DOCS.get(docType);

async function load(docType: string, id: string) {
  const doc = DOCS.get(docType);
  if (!doc) throw notFound('Document type');
  const row = await doc.find(id);
  if (!row || row.deletedAt) throw notFound(doc.label);
  return { doc, row };
}
const levelsOf = (row: { workflowLevels: unknown }) =>
  Array.isArray(row.workflowLevels) ? (row.workflowLevels as Level[]) : [];
const refuse = (message: string) => new AppError('DUPLICATE', message);
const required = (value: unknown, key: string, message: string) => {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) throw new AppError('VALIDATION', 'Please correct the highlighted fields.', { [key]: message });
  if (v.length > 2000)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', {
      [key]: 'At most 2000 characters.',
    });
  return v;
};
const optional = (value: unknown) => {
  const v = typeof value === 'string' ? value.trim() : '';
  return v ? v.slice(0, 2000) : null;
};

async function move(
  doc: WorkflowDoc,
  row: WorkflowRow & Record<string, unknown>,
  data: Partial<State>,
  log: { action: string; level: Level | null; comment: string | null },
  userId: string,
  approved = false,
) {
  const from: State = {
    status: row.status,
    workflowLevels: row.workflowLevels,
    currentStep: row.currentStep,
    submittedAt: row.submittedAt,
    decidedAt: row.decidedAt,
  };
  await db.$transaction(async (tx) => {
    const changed = await doc.update(tx, row.id, from, data);
    if (changed !== 1) throw refuse('Someone else acted on this document just now. Open it again.');
    await tx.budgetWorkflowLog.create({
      data: {
        id: newId(),
        docType: doc.docType,
        docId: row.id,
        levelKey: log.level?.key ?? null,
        levelName: log.level?.name ?? null,
        action: log.action,
        comment: log.comment,
        userId,
      },
    });
    await writeHistory(tx, {
      resource: doc.resource,
      recordId: row.id,
      action: 'update',
      oldData: { status: from.status, currentStep: from.currentStep },
      newData: {
        status: data.status ?? from.status,
        currentStep: data.currentStep ?? from.currentStep,
        workflow: log.action,
        level: log.level?.name ?? null,
        comment: log.comment,
      },
      userId,
      approvalId: null,
    });
    if (approved && doc.onApproved) await doc.onApproved(tx, row, userId);
  });
}

/** The workflow card: Prepared, then each level with its state; and the whole log. */
export async function workflowView(docType: string, row: WorkflowRow & Record<string, unknown>) {
  const doc = DOCS.get(docType);
  const logs = await db.budgetWorkflowLog.findMany({
    where: { docType, docId: row.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const userIds = [...new Set([...logs.map((l) => l.userId), row.createdBy])];
  const users = new Map(
    (await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map(
      (u) => [u.id, u.name],
    ),
  );
  const lastSubmit = logs.map((l) => l.action).lastIndexOf('SUBMITTED');
  const round =
    lastSubmit >= 0 && row.status !== 'DRAFT' && row.status !== 'RETURNED' ? logs.slice(lastSubmit) : [];
  const live = row.status === 'PENDING' || row.status === 'APPROVED' || row.status === 'REJECTED';
  const levels = live ? levelsOf(row) : (await budgetSettings()).approvalLevels.filter((l) => l.required);
  const submit = round[0];
  const steps = levels.map((l, i) => {
    const act = round.find((x) => x.levelKey === l.key && ['APPROVED', 'REJECTED'].includes(x.action));
    const state =
      row.status === 'APPROVED' || (act && act.action === 'APPROVED')
        ? 'done'
        : act && act.action === 'REJECTED'
          ? 'rejected'
          : row.status === 'PENDING' && row.currentStep === i
            ? 'current'
            : 'pending';
    return {
      position: i + 1,
      key: l.key,
      name: l.name,
      role: l.role,
      state,
      stateLabel: { done: 'Approved', rejected: 'Rejected', current: 'Pending', pending: 'Pending' }[state],
      actedBy: act?.userId ?? null,
      actedByName: act ? (users.get(act.userId) ?? null) : null,
      actedAt: act?.createdAt ?? null,
      comment: act?.comment ?? null,
    };
  });
  return {
    docType,
    docLabel: doc?.label ?? docType,
    id: row.id,
    code: doc ? doc.code(row) : null,
    status: row.status,
    statusLabel: statusLabel(row.status),
    currentStep: row.status === 'PENDING' ? row.currentStep : null,
    currentLevel:
      row.status === 'PENDING' && row.currentStep !== null ? (levels[row.currentStep] ?? null) : null,
    prepared: submit
      ? { by: submit.userId, byName: users.get(submit.userId) ?? null, at: submit.createdAt }
      : { by: row.createdBy, byName: users.get(row.createdBy) ?? null, at: null },
    steps,
    log: logs.map((l) => ({
      action: l.action,
      actionLabel: ACTIONS[l.action] ?? l.action,
      levelKey: l.levelKey,
      levelName: l.levelName,
      comment: l.comment,
      by: l.userId,
      byName: users.get(l.userId) ?? null,
      at: l.createdAt,
    })),
  };
}

export const budgetWorkflowRouter = Router();

budgetWorkflowRouter.get('/:docType/:id', async (req, res) => {
  const { row } = await load(req.params.docType, req.params.id);
  res.json(await workflowView(req.params.docType, row));
});

budgetWorkflowRouter.post('/:docType/:id/submit', async (req, res) => {
  const { doc, row } = await load(req.params.docType, req.params.id);
  if (!EDITABLE.includes(row.status))
    throw refuse(
      `This ${doc.label.toLowerCase()} is ${statusLabel(row.status)}: only a Draft or Returned one can be submitted.`,
    );
  const problem = doc.canSubmit ? await doc.canSubmit(row) : undefined;
  if (problem) throw new AppError('VALIDATION', problem, { submit: problem });
  const levels = (await budgetSettings()).approvalLevels
    .filter((l) => l.required)
    .map(({ key, name, role }) => ({ key, name, role }));
  const body = (req.body ?? {}) as Record<string, unknown>;
  await move(
    doc,
    row,
    { status: 'PENDING', workflowLevels: levels, currentStep: 0, submittedAt: new Date(), decidedAt: null },
    { action: 'SUBMITTED', level: null, comment: optional(body.comment) },
    currentUserId(req),
  );
  res.json(
    await workflowView(doc.docType, (await doc.find(row.id)) as WorkflowRow & Record<string, unknown>),
  );
});

/** The level waiting to act, or a refusal when the document is not pending. */
function pendingLevel(doc: WorkflowDoc, row: WorkflowRow) {
  if (row.status !== 'PENDING' || row.currentStep === null)
    throw refuse(`This ${doc.label.toLowerCase()} is ${statusLabel(row.status)}, not waiting for approval.`);
  const level = levelsOf(row)[row.currentStep];
  if (!level) throw refuse('This document has no approval level waiting.');
  return level;
}

budgetWorkflowRouter.post('/:docType/:id/approve', async (req, res) => {
  const { doc, row } = await load(req.params.docType, req.params.id);
  const level = pendingLevel(doc, row);
  const last = (row.currentStep ?? 0) + 1 >= levelsOf(row).length;
  const body = (req.body ?? {}) as Record<string, unknown>;
  await move(
    doc,
    row,
    last
      ? { status: 'APPROVED', currentStep: null, decidedAt: new Date() }
      : { currentStep: (row.currentStep ?? 0) + 1 },
    { action: 'APPROVED', level, comment: optional(body.comment) },
    currentUserId(req),
    last,
  );
  res.json(
    await workflowView(doc.docType, (await doc.find(row.id)) as WorkflowRow & Record<string, unknown>),
  );
});

budgetWorkflowRouter.post('/:docType/:id/reject', async (req, res) => {
  const { doc, row } = await load(req.params.docType, req.params.id);
  const level = pendingLevel(doc, row);
  const reason = required(
    (req.body as Record<string, unknown> | undefined)?.reason,
    'reason',
    'Enter the reason for rejecting.',
  );
  await move(
    doc,
    row,
    { status: 'REJECTED', decidedAt: new Date() },
    { action: 'REJECTED', level, comment: reason },
    currentUserId(req),
  );
  res.json(
    await workflowView(doc.docType, (await doc.find(row.id)) as WorkflowRow & Record<string, unknown>),
  );
});

budgetWorkflowRouter.post('/:docType/:id/return', async (req, res) => {
  const { doc, row } = await load(req.params.docType, req.params.id);
  const level = pendingLevel(doc, row);
  const comment = required(
    (req.body as Record<string, unknown> | undefined)?.comment,
    'comment',
    'Say what should be changed.',
  );
  await move(
    doc,
    row,
    { status: 'RETURNED', currentStep: null },
    { action: 'RETURNED', level, comment },
    currentUserId(req),
  );
  res.json(
    await workflowView(doc.docType, (await doc.find(row.id)) as WorkflowRow & Record<string, unknown>),
  );
});

budgetWorkflowRouter.post('/:docType/:id/request-info', async (req, res) => {
  const { doc, row } = await load(req.params.docType, req.params.id);
  const level = pendingLevel(doc, row);
  const comment = required(
    (req.body as Record<string, unknown> | undefined)?.comment,
    'comment',
    'Enter the information you need.',
  );
  await move(doc, row, {}, { action: 'INFO_REQUESTED', level, comment }, currentUserId(req));
  res.json(
    await workflowView(doc.docType, (await doc.find(row.id)) as WorkflowRow & Record<string, unknown>),
  );
});

budgetWorkflowRouter.post('/:docType/:id/reply', async (req, res) => {
  const { doc, row } = await load(req.params.docType, req.params.id);
  const level = pendingLevel(doc, row);
  const comment = required(
    (req.body as Record<string, unknown> | undefined)?.comment,
    'comment',
    'Enter your reply.',
  );
  await move(doc, row, {}, { action: 'INFO_REPLIED', level, comment }, currentUserId(req));
  res.json(
    await workflowView(doc.docType, (await doc.find(row.id)) as WorkflowRow & Record<string, unknown>),
  );
});

docsPaths['/budget-workflow/{docType}/{id}'] = {
  get: {
    tags: ['Budget'],
    summary: 'Workflow card and log of a budget document (docType ANNUAL_BUDGET, ...)',
    responses: { '200': { description: 'workflow' } },
  },
};
for (const [action, summary] of [
  [
    'submit',
    'Submit for Approval (Draft / Returned): takes the Required levels of Budget Settings; { comment? }',
  ],
  ['approve', 'Approve the current level; the last one makes it Approved; { comment? }'],
  ['reject', 'Reject at the current level (final); { reason }'],
  ['return', 'Return to the preparer to edit and submit again; { comment }'],
  ['request-info', 'Ask for more information; stays at the level; { comment }'],
  ['reply', 'Answer a request for information; { comment }'],
] as const)
  docsPaths[`/budget-workflow/{docType}/{id}/${action}`] = {
    post: {
      tags: ['Budget'],
      summary,
      responses: {
        '200': { description: 'workflow card' },
        '400': { description: 'fields' },
        '409': { description: 'not in the right status' },
      },
    },
  };
