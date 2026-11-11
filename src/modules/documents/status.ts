import { type Prisma } from '../../generated/prisma/client.js';
import { type db } from '../../lib/db.js';
import { type Reminder } from './expiry.js';

/**
 * RP1-151: a document's status, worked out on every read from the dates (Bangladesh time):
 * - Inactive: "Set as Active" is off.
 * - Expired: past its Expiry Date.
 * - Expiring Soon: on or after `expiringFrom` (Expiry Date minus its largest reminder), not yet expired.
 * - Active: everything else, documents without an Expiry Date included.
 * A type with Auto Status Update off keeps its documents Active / Inactive only.
 */
export const DOCUMENT_STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'EXPIRING_SOON', label: 'Expiring Soon' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'INACTIVE', label: 'Inactive' },
];
export const statusLabel = (value: string) =>
  DOCUMENT_STATUSES.find((s) => s.value === value)?.label ?? value;

const DAY = 86_400_000;

/** Today in Bangladesh (UTC+6), as a date at 00:00 UTC like the saved dates. */
export function today(now = new Date()) {
  const bd = new Date(now.getTime() + 6 * 3_600_000);
  return new Date(Date.UTC(bd.getUTCFullYear(), bd.getUTCMonth(), bd.getUTCDate()));
}
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

/** Days from today to the expiry date (negative once expired); null without one. */
export const daysLeft = (expiry: Date | null, on = today()) =>
  expiry ? Math.round((expiry.getTime() - on.getTime()) / DAY) : null;

/** The Days Left badge colour, as image 1 shows it (12 red, 28 / 38 amber, 53 / 65 green). */
export const daysLeftLevel = (days: number | null) =>
  days === null ? null : days <= 15 ? 'danger' : days <= 45 ? 'warning' : 'ok';

/** How many days before expiry a document turns Expiring Soon. */
export function windowDays(
  doc: { reminderSetting: unknown; reminderDays: unknown },
  type: { reminders: unknown; defaultReminderDays: number },
) {
  const custom =
    doc.reminderSetting === 'CUSTOM' && Array.isArray(doc.reminderDays) ? (doc.reminderDays as number[]) : [];
  if (custom.length) return Math.max(...custom);
  const own = ((type.reminders ?? []) as Reminder[]).filter((r) => r.enabled).map((r) => r.days);
  return own.length ? Math.max(...own) : type.defaultReminderDays;
}

export const expiringFromOf = (expiry: unknown, window: number) =>
  expiry instanceof Date ? addDays(expiry, -window) : null;

type Where = Prisma.DocumentWhereInput;
const tracked: Where = { isActive: true, typeRef: { autoStatusUpdate: true } };

/** The register's Status filter as a database condition. */
export function statusWhere(status: string, on = today()): Where {
  switch (status) {
    case 'INACTIVE':
      return { isActive: false };
    case 'EXPIRED':
      return { ...tracked, expiryDate: { lt: on } };
    case 'EXPIRING_SOON':
      return { ...tracked, expiryDate: { gte: on }, expiringFrom: { lte: on } };
    case 'ACTIVE':
      return {
        isActive: true,
        OR: [
          { expiryDate: null },
          { typeRef: { autoStatusUpdate: false } },
          { expiryDate: { gte: on }, expiringFrom: { gt: on } },
        ],
      };
    default:
      // An unknown status matches nothing.
      return { id: '' };
  }
}

export function statusOf(doc: Record<string, unknown>, autoStatusUpdate: boolean, on = today()) {
  if (doc.isActive === false) return 'INACTIVE';
  const expiry = doc.expiryDate instanceof Date ? doc.expiryDate : null;
  if (!expiry || !autoStatusUpdate) return 'ACTIVE';
  if (expiry < on) return 'EXPIRED';
  const from = doc.expiringFrom instanceof Date ? doc.expiringFrom : null;
  return from && from <= on ? 'EXPIRING_SOON' : 'ACTIVE';
}

/** After a type's reminders change, its documents on Use Default get their new Expiring Soon day. */
export async function refreshExpiringFrom(tx: Prisma.TransactionClient | typeof db, typeId: string) {
  const type = await tx.documentType.findUnique({
    where: { id: typeId },
    select: { reminders: true, defaultReminderDays: true },
  });
  if (!type) return;
  const docs = await tx.document.findMany({
    where: { type: typeId, expiryDate: { not: null } },
    select: { id: true, expiryDate: true, reminderSetting: true, reminderDays: true },
  });
  for (const d of docs)
    await tx.document.update({
      where: { id: d.id },
      data: { expiringFrom: expiringFromOf(d.expiryDate, windowDays(d, type)) },
    });
}
