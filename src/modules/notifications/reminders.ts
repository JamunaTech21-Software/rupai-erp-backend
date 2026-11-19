import type { Tx } from '../../lib/history.js';
import { db } from '../../lib/db.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { enabledDays, isoDate } from '../documents/documents.js';
import { DEFAULT_SETTINGS, SETTINGS_ID } from '../documents/expiry.js';
import { daysLeft, today } from '../documents/status.js';

/**
 * RP1-201 N.9 Document expiry reminders as in-app notifications (Expiry & Renewal Setting, Renewal Rule 1).
 *
 * The job runs at server start and then every hour; each run is safe to repeat (one notification per document,
 * expiry date and reminder, by `dedupe_key`). For every active, tracked document (its type has Auto Status
 * Update on) with an expiry date:
 * - before expiry: when the days left reach one of its reminder days (custom, or the type's enabled reminders,
 *   e.g. 90 / 60 / 30 / 7) it posts that reminder. Only the latest one stays in the bell: a new reminder
 *   resolves the document's earlier ones, so a document that is already at 6 days gets just the 7-day one.
 * - after expiry: once the type's Escalation Days have passed and it is still not renewed, one escalation.
 *
 * Settings: Enable Expiry Tracking off or In-App Notification off = nothing is posted; Enable Renewal Reminder
 * off = no reminders (escalations still follow tracking). Email and SMS stay settings only.
 * A notification is resolved (leaves the bell) when it no longer applies: the document was renewed or its
 * expiry date changed, or it was deleted or set Inactive.
 */
export const KINDS = [
  { value: 'DOCUMENT_REMINDER', label: 'Expiry Reminder' },
  { value: 'DOCUMENT_ESCALATION', label: 'Escalation' },
];
const HOUR = 3_600_000;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function reminderSettings() {
  const row = await db.documentSettings.findUnique({ where: { id: SETTINGS_ID } });
  return {
    enableExpiryTracking: row?.enableExpiryTracking ?? DEFAULT_SETTINGS.enableExpiryTracking,
    enableRenewalReminder: row?.enableRenewalReminder ?? DEFAULT_SETTINGS.enableRenewalReminder,
    inAppEnabled: row?.inAppEnabled ?? DEFAULT_SETTINGS.inAppEnabled,
  };
}

/** Resolves the open notifications of one document (renewal, RP1-197). */
export async function resolveDocumentNotifications(tx: Tx, documentId: string) {
  await tx.notification.updateMany({
    where: { resource: 'document', recordId: documentId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}

export interface ReminderRun {
  posted: number;
  resolved: number;
  /** Why nothing was posted, when a setting is off. */
  skipped: string | null;
}

/** One pass of the reminder job, as of `on` (today in Bangladesh). */
export async function runReminders(on = today()): Promise<ReminderRun> {
  const now = new Date();
  const docs = await db.document.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      documentNo: true,
      documentName: true,
      expiryDate: true,
      isActive: true,
      reminderSetting: true,
      reminderDays: true,
      typeRef: {
        select: {
          typeName: true,
          reminders: true,
          defaultReminderDays: true,
          escalationDays: true,
          autoStatusUpdate: true,
        },
      },
    },
  });
  const byId = new Map(docs.map((d) => [d.id, d]));

  // Resolve what no longer applies.
  const open = await db.notification.findMany({
    where: { resource: 'document', resolvedAt: null },
    select: { id: true, recordId: true, dueDate: true },
  });
  const stale = open
    .filter((n) => {
      const d = byId.get(n.recordId);
      return (
        !d ||
        !d.isActive ||
        !d.typeRef.autoStatusUpdate ||
        isoDate(d.expiryDate) === null ||
        isoDate(d.expiryDate) !== isoDate(n.dueDate)
      );
    })
    .map((n) => n.id);
  let resolved = 0;
  if (stale.length)
    resolved += (
      await db.notification.updateMany({ where: { id: { in: stale } }, data: { resolvedAt: now } })
    ).count;

  const settings = await reminderSettings();
  const skipped = !settings.enableExpiryTracking
    ? 'Enable Expiry Tracking is off.'
    : !settings.inAppEnabled
      ? 'In-App Notification is off.'
      : null;
  if (skipped) return { posted: 0, resolved, skipped };

  let posted = 0;
  for (const d of docs) {
    if (!d.isActive || !d.typeRef.autoStatusUpdate || !d.expiryDate) continue;
    const left = daysLeft(d.expiryDate, on) ?? 0;
    const due = isoDate(d.expiryDate) ?? '';
    const name = `${d.documentNo} (${d.documentName})`;
    let note: {
      key: string;
      kind: string;
      title: string;
      message: string;
      level: string;
      stage: number | null;
    } | null = null;
    if (left >= 0 && settings.enableRenewalReminder) {
      const custom =
        d.reminderSetting === 'CUSTOM' && Array.isArray(d.reminderDays) ? (d.reminderDays as number[]) : [];
      const own = custom.length ? custom : enabledDays(d.typeRef.reminders);
      const days = own.length ? own : [d.typeRef.defaultReminderDays];
      const reached = days.filter((n) => left <= n);
      if (reached.length) {
        const stage = Math.min(...reached);
        note = {
          key: `document:${d.id}:${due}:R${stage}`,
          kind: 'DOCUMENT_REMINDER',
          title:
            left === 0
              ? `${d.typeRef.typeName} expires today`
              : `${d.typeRef.typeName} expires in ${plural(left, 'day')}`,
          message: `${name} expires on ${due}. ${stage}-day reminder: renew it before it expires.`,
          level: left <= 7 ? 'danger' : 'warning',
          stage,
        };
      }
    } else if (left < 0 && -left >= d.typeRef.escalationDays) {
      note = {
        key: `document:${d.id}:${due}:ESC`,
        kind: 'DOCUMENT_ESCALATION',
        title: `${d.typeRef.typeName} not renewed`,
        message: `${name} expired on ${due} and has not been renewed after ${plural(d.typeRef.escalationDays, 'day')}.`,
        level: 'danger',
        stage: null,
      };
    }
    if (!note) continue;
    const exists = await db.notification.findUnique({ where: { dedupeKey: note.key }, select: { id: true } });
    if (exists) continue;
    const id = newId();
    await db.$transaction(async (tx) => {
      // Only the newest one per document stays in the bell.
      resolved += (
        await tx.notification.updateMany({
          where: { resource: 'document', recordId: d.id, resolvedAt: null },
          data: { resolvedAt: now },
        })
      ).count;
      await tx.notification.create({
        data: {
          id,
          kind: note.kind,
          resource: 'document',
          recordId: d.id,
          dedupeKey: note.key,
          title: note.title,
          message: note.message,
          level: note.level,
          dueDate: d.expiryDate,
          stageDays: note.stage,
        },
      });
    });
    posted += 1;
  }
  return { posted, resolved, skipped: null };
}

let timer: NodeJS.Timeout | null = null;

/** Starts the hourly job (not in tests). The first pass runs a few seconds after start. */
export function startReminderJob() {
  if (timer) return;
  const pass = () =>
    runReminders()
      .then((r) => {
        if (r.posted || r.resolved) logger.info({ reminders: r }, 'Document reminders');
      })
      .catch((error: unknown) => logger.error({ err: error }, 'Document reminders failed'));
  setTimeout(() => void pass(), 5_000).unref();
  timer = setInterval(() => void pass(), HOUR);
  timer.unref();
}
