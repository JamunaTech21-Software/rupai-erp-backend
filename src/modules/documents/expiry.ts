import { db } from '../../lib/db.js';
import { bool, int, oneOf } from '../../lib/fields.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-142 / RP1-145: Expiry & Renewal values. The global settings (image 4) are one saved row; a new document
 * type starts from them, and each type then keeps its own values (image 5).
 */
export const SETTINGS_ID = 'DOCUMENTSETTINGS0000000000';
export const UNITS = [
  { value: 'DAYS', label: 'Days', days: 1 },
  { value: 'WEEKS', label: 'Weeks', days: 7 },
  { value: 'MONTHS', label: 'Months', days: 30 },
];
export const RENEWAL_VALIDITY = [
  { value: 'SAME', label: 'Same as Previous' },
  { value: 'CUSTOM', label: 'Custom (Months)' },
];
export const REMINDER_NAMES = ['First Reminder', 'Second Reminder', 'Third Reminder', 'Final Reminder'];
/** The dropdowns of image 4. */
export const REMINDER_DAY_CHOICES = [7, 15, 30, 45, 60, 90];
export const ESCALATION_DAY_CHOICES = [3, 7, 10, 15, 30];
export const REMINDER_VALUE_CHOICES = [1, 2, 3, 7, 14, 15, 30, 45, 60, 90, 120, 180];

export type Reminder = { enabled: boolean; days: number };
export type GlobalReminder = { enabled: boolean; value: number; unit: string };

export const DEFAULT_SETTINGS = {
  enableExpiryTracking: true,
  enableRenewalReminder: true,
  defaultReminderDays: 30,
  escalationDays: 7,
  reminders: [
    { enabled: true, value: 90, unit: 'DAYS' },
    { enabled: true, value: 60, unit: 'DAYS' },
    { enabled: true, value: 30, unit: 'DAYS' },
    { enabled: true, value: 7, unit: 'DAYS' },
  ] as GlobalReminder[],
  emailEnabled: true,
  inAppEnabled: true,
  smsEnabled: false,
};

export const DEFAULT_TYPE_EXPIRY = {
  defaultReminderDays: 30,
  escalationDays: 7,
  autoStatusUpdate: true,
  renewalValidity: 'SAME',
  renewalValidityMonths: null as number | null,
  allowVersionUpload: true,
  keepPreviousVersions: true,
  notifyResponsible: true,
  reminders: [
    { enabled: true, days: 90 },
    { enabled: true, days: 60 },
    { enabled: true, days: 30 },
    { enabled: true, days: 7 },
  ] as Reminder[],
};

/** A reminder's length in days (1 week = 7, 1 month = 30). */
export const daysOf = (r: GlobalReminder) => r.value * (UNITS.find((u) => u.value === r.unit)?.days ?? 1);

/** The saved global settings, or the defaults before the first save. */
export async function globalSettings() {
  const row = await db.documentSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (!row) return { ...DEFAULT_SETTINGS, updatedAt: null, updatedBy: null };
  return { ...row, reminders: row.reminders as GlobalReminder[] };
}

/** The expiry values a new type gets: the global settings' days and reminders, the rest as the defaults. */
export async function newTypeExpiry() {
  const g = await globalSettings();
  return {
    ...DEFAULT_TYPE_EXPIRY,
    defaultReminderDays: g.defaultReminderDays,
    escalationDays: g.escalationDays,
    reminders: g.reminders.map((r) => ({ enabled: r.enabled, days: daysOf(r) })),
  };
}

const days = () => int('Must be 1 or more.').refine((v) => v >= 1 && v <= 365, 'Use 1 to 365 days.');
const toggle = () =>
  bool()
    .refine((v) => v !== null, 'This field is required.')
    .transform((v) => v === true);

/** Turned-on reminders must count down: First more days before expiry than Second, and so on. */
function inOrder(list: { enabled: boolean }[], daysAt: (i: number) => number) {
  const fields: Record<string, string> = {};
  let last = Infinity;
  list.forEach((r, i) => {
    if (!r.enabled) return;
    const d = daysAt(i);
    if (d >= last)
      fields[`reminders.${i}`] = `${REMINDER_NAMES[i]} must be fewer days before expiry than the one above.`;
    last = Math.min(last, d);
  });
  return fields;
}

export const globalSchema = z.object({
  enableExpiryTracking: toggle(),
  enableRenewalReminder: toggle(),
  defaultReminderDays: days(),
  escalationDays: days(),
  reminders: z
    .array(
      z.object({
        enabled: toggle(),
        value: int('Must be 1 or more.').refine((v) => v >= 1 && v <= 365, 'Use 1 to 365.'),
        unit: oneOf(UNITS.map((u) => u.value)),
      }),
      { error: 'Send the 4 reminders.' },
    )
    .length(4, 'Send the 4 reminders.'),
  emailEnabled: toggle(),
  inAppEnabled: toggle(),
  smsEnabled: toggle(),
});
export const checkGlobal = (v: z.infer<typeof globalSchema>) => {
  const fields = inOrder(v.reminders, (i) => daysOf(v.reminders[i] as GlobalReminder));
  for (const [i, r] of v.reminders.entries())
    if (daysOf(r) > 365) fields[`reminders.${i}`] = 'At most one year (365 days) before expiry.';
  return fields;
};

export const typeExpirySchema = z.object({
  defaultReminderDays: days(),
  escalationDays: days(),
  renewalRequired: toggle(),
  autoStatusUpdate: toggle(),
  renewalValidity: oneOf(RENEWAL_VALIDITY.map((o) => o.value)),
  renewalValidityMonths: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.union([z.null(), int('Must be 1 or more.')]),
  ),
  allowVersionUpload: toggle(),
  keepPreviousVersions: toggle(),
  notifyResponsible: toggle(),
  reminders: z
    .array(z.object({ enabled: toggle(), days: days() }), { error: 'Send the 4 reminders.' })
    .length(4, 'Send the 4 reminders.'),
});
export const checkTypeExpiry = (v: z.infer<typeof typeExpirySchema>) => {
  const fields = inOrder(v.reminders, (i) => v.reminders[i]?.days ?? 0);
  if (v.renewalValidity === 'CUSTOM') {
    const m = v.renewalValidityMonths;
    if (m === null) fields.renewalValidityMonths = 'Enter the months.';
    else if (m < 1 || m > 120) fields.renewalValidityMonths = 'Use 1 to 120 months.';
  }
  return fields;
};
