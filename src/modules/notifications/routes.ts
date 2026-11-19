import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { currentUserId } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { isoDate } from '../documents/documents.js';
import { daysLeft, statusLabel, statusOf, today } from '../documents/status.js';
import { KINDS, runReminders } from './reminders.js';

/**
 * RP1-201 N.9 The header bell: open (unresolved) notifications, newest first, with whether the signed-in user
 * has read each one. Every user sees the same notifications (no roles in Phase 1); read state is per user.
 */
export const notificationsRouter = Router();

const Query = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  perPage: z.coerce.number().int().min(1).max(100).catch(10),
  unread: z.enum(['true', 'false']).optional().catch(undefined),
});

const kindLabel = (v: string) => KINDS.find((k) => k.value === v)?.label ?? v;
const open = { resolvedAt: null };
const unreadBy = (userId: string) => ({ ...open, reads: { none: { userId } } });

notificationsRouter.get('/unread-count', async (req, res) => {
  res.json({ unread: await db.notification.count({ where: unreadBy(currentUserId(req)) }) });
});

notificationsRouter.get('/', async (req, res) => {
  const userId = currentUserId(req);
  const { page, perPage, unread } = Query.parse(req.query);
  const where =
    unread === 'true'
      ? unreadBy(userId)
      : unread === 'false'
        ? { ...open, reads: { some: { userId } } }
        : open;
  const [total, unreadCount, rows] = await Promise.all([
    db.notification.count({ where }),
    db.notification.count({ where: unreadBy(userId) }),
    db.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
      include: { reads: { where: { userId }, select: { readAt: true } } },
    }),
  ]);
  const docs = await db.document.findMany({
    where: { id: { in: [...new Set(rows.filter((r) => r.resource === 'document').map((r) => r.recordId))] } },
    select: {
      id: true,
      documentNo: true,
      documentName: true,
      expiryDate: true,
      expiringFrom: true,
      isActive: true,
      typeRef: { select: { autoStatusUpdate: true } },
    },
  });
  const on = today();
  res.json({
    data: rows.map((r) => {
      const d = docs.find((x) => x.id === r.recordId);
      const status = d ? statusOf(d, d.typeRef.autoStatusUpdate, on) : null;
      return {
        id: r.id,
        kind: r.kind,
        kindLabel: kindLabel(r.kind),
        title: r.title,
        message: r.message,
        level: r.level,
        read: r.reads.length > 0,
        readAt: r.reads[0]?.readAt.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        // The document it is about (opens /documents-register, or the document view).
        documentId: r.recordId,
        documentNo: d?.documentNo ?? null,
        documentName: d?.documentName ?? null,
        expiryDate: isoDate(d?.expiryDate ?? null),
        daysLeft: d ? daysLeft(d.expiryDate, on) : null,
        status,
        statusLabel: status ? statusLabel(status) : null,
      };
    }),
    meta: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)), unread: unreadCount },
  });
});

notificationsRouter.post('/read-all', async (req, res) => {
  const userId = currentUserId(req);
  const ids = await db.notification.findMany({ where: unreadBy(userId), select: { id: true } });
  const { count } = await db.notificationRead.createMany({
    data: ids.map((n) => ({ notificationId: n.id, userId })),
    skipDuplicates: true,
  });
  res.json({ marked: count, unread: 0 });
});

/** Runs the reminder job now (it also runs every hour): for testing and after changing settings. */
notificationsRouter.post('/run-reminders', async (_req, res) => {
  res.json(await runReminders());
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const userId = currentUserId(req);
  const row = await db.notification.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!row) throw notFound('Notification');
  await db.notificationRead.createMany({ data: [{ notificationId: row.id, userId }], skipDuplicates: true });
  res.json({ id: row.id, read: true, unread: await db.notification.count({ where: unreadBy(userId) }) });
});

const tags = ['Notification'];
const idParam = [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }];
docsPaths['/notifications'] = {
  get: {
    tags,
    summary: 'Header bell: open notifications, newest first (unread=true|false to filter)',
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer' } },
      { name: 'perPage', in: 'query', schema: { type: 'integer', maximum: 100 } },
      { name: 'unread', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
    ],
    responses: {
      '200': {
        description:
          '{ data: [{ id, kind, kindLabel, title, message, level (warning | danger), read, readAt, createdAt, documentId, documentNo, documentName, expiryDate, daysLeft, status, statusLabel }], meta: { page, perPage, total, totalPages, unread } }',
      },
    },
  },
};
docsPaths['/notifications/unread-count'] = {
  get: { tags, summary: 'The bell badge: { unread }', responses: { '200': { description: '{ unread }' } } },
};
docsPaths['/notifications/{id}/read'] = {
  post: {
    tags,
    summary: 'Mark one as read (for the signed-in user)',
    parameters: idParam,
    responses: { '200': { description: '{ id, read, unread }' }, '404': { description: 'Not found' } },
  },
};
docsPaths['/notifications/read-all'] = {
  post: { tags, summary: 'Mark all as read', responses: { '200': { description: '{ marked, unread }' } } },
};
docsPaths['/notifications/run-reminders'] = {
  post: {
    tags,
    summary: 'Run the document reminder job now (it runs every hour)',
    responses: { '200': { description: '{ posted, resolved, skipped }' } },
  },
};
