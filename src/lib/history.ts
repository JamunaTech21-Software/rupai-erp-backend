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
    userId: string;
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
    },
  });
}

/** The edit log of one record, newest first, with the name of who changed it. */
export async function readHistory(resource: string, recordId: string) {
  const rows = await db.recordHistory.findMany({
    where: { resource, recordId },
    orderBy: { changedAt: 'desc' },
  });
  const userIds = [...new Set(rows.map((r) => r.changedBy))];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    action: r.action,
    oldData: r.oldData,
    newData: r.newData,
    changedBy: { id: r.changedBy, name: names.get(r.changedBy) ?? 'Unknown' },
    changedAt: r.changedAt.toISOString(),
  }));
}
