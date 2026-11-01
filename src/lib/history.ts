import type { Prisma } from '../generated/prisma/client.js';
import { type Database, db } from './db.js';
import { newId } from './ids.js';
import { toJson } from './serialize.js';

export type HistoryAction = 'create' | 'update' | 'delete' | 'restore';
export type Tx = Parameters<Parameters<Database['$transaction']>[0]>[0];

/** Writes one edit-log row in the same transaction as the change. */
export async function writeHistory(
  tx: Tx,
  entry: {
    resource: string;
    recordId: string;
    action: HistoryAction;
    oldData?: unknown;
    newData?: unknown;
    /** Who made the change: the requester when it came through approval. */
    userId: string;
    /** The approved change request it came from (RP1-69). */
    approvalId?: string | null;
  },
): Promise<void> {
  await tx.recordHistory.create({
    data: {
      id: newId(),
      resource: entry.resource,
      recordId: entry.recordId,
      action: entry.action,
      oldData: (entry.oldData === undefined ? undefined : toJson(entry.oldData)) as
        Prisma.InputJsonValue | undefined,
      newData: (entry.newData === undefined ? undefined : toJson(entry.newData)) as
        Prisma.InputJsonValue | undefined,
      changedBy: entry.userId,
      approvalId: entry.approvalId ?? null,
    },
  });
}

/** The edit log of one record, newest first, with the name of who changed it. */
export async function readHistory(resource: string, recordId: string) {
  const rows = await db.recordHistory.findMany({
    where: { resource, recordId },
    orderBy: { changedAt: 'desc' },
  });
  const approvalIds = [...new Set(rows.map((r) => r.approvalId).filter((v): v is string => v !== null))];
  const approvals = new Map(
    (
      await db.changeRequest.findMany({
        where: { id: { in: approvalIds } },
        select: { id: true, seq: true, reviewedBy: true, reviewedAt: true },
      })
    ).map((a) => [a.id, a]),
  );
  const userIds = [
    ...new Set([
      ...rows.map((r) => r.changedBy),
      ...[...approvals.values()].map((a) => a.reviewedBy).filter((v): v is string => v !== null),
    ]),
  ];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  const person = (id: string) => ({ id, name: names.get(id) ?? 'Unknown' });
  return rows.map((r) => {
    const a = r.approvalId ? approvals.get(r.approvalId) : undefined;
    return {
      action: r.action,
      oldData: r.oldData,
      newData: r.newData,
      changedBy: person(r.changedBy),
      changedAt: r.changedAt.toISOString(),
      /** Set when the change came through approval: the request and who approved it. */
      approval: a
        ? {
            id: a.id,
            requestNo: `REQ-${String(a.seq).padStart(4, '0')}`,
            approvedBy: a.reviewedBy ? person(a.reviewedBy) : null,
            approvedAt: a.reviewedAt?.toISOString() ?? null,
          }
        : null,
    };
  });
}
