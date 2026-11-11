import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { bool, fileId, int, oneOf, optDate, optText, ref, reqDate, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { type Reminder } from './expiry.js';
import {
  DOCUMENT_STATUSES,
  daysLeft,
  daysLeftLevel,
  expiringFromOf,
  statusLabel,
  statusOf,
  statusWhere,
  today,
  windowDays,
} from './status.js';

/**
 * RP1-148 N.4 Add New Document (`/documents-add-new` and the dashboard's pop-up, image 6). Document
 * Information: Category, Type, Document Name, Document No., Issuing Authority, Issue Date, Expiry Date,
 * Validity Period (Months), Renewal Required, Reminder Settings. Attachment: one PDF, JPG or PNG (10 MB, from
 * `POST /files`). Description / Remarks and Set as Active. RP1-151 N.5 Document Register (`/documents-register`):
 * status and Days Left on every row (see `status.ts`), filters, cards and export.
 */
export const REMINDER_SETTINGS = [
  { value: 'DEFAULT', label: 'Use Default' },
  { value: 'CUSTOM', label: 'Custom' },
];
const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const VALIDATION_MONTHS = 'Must match the Issue and Expiry Dates';

const documentSchema = z.object({
  category: ref(),
  type: ref(),
  documentName: text(200),
  documentNo: text(60),
  issuingAuthority: optText(200),
  issueDate: reqDate(),
  expiryDate: optDate(),
  validityMonths: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.union([z.null(), int('Must be 1 or more.')]),
  ),
  renewalRequired: bool()
    .refine((v) => v !== null, 'This field is required.')
    .transform((v) => v === true),
  reminderSetting: oneOf(REMINDER_SETTINGS.map((o) => o.value)),
  reminderDays: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.union([
      z.null(),
      z
        .array(
          int('Must be 1 or more.').refine((d) => d >= 1 && d <= 365, 'Use 1 to 365 days.'),
          {
            error: 'Enter the reminder days.',
          },
        )
        .max(4, 'At most 4 reminders.'),
    ]),
  ),
  attachment: fileId(),
  remarks: optText(1000),
  isActive: bool().transform((v) => v !== false),
});

/** Whole months from issue to expiry (20 Oct 2026 to 20 Oct 2028 is 24). */
export function monthsBetween(from: Date, to: Date) {
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
  return to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
}

const validDate = (v: string) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const isoDate = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : null);

const enabledDays = (reminders: unknown) =>
  ((reminders ?? []) as Reminder[]).filter((r) => r.enabled).map((r) => r.days);
const daysText = (days: number[]) => (days.length ? `${days.join(', ')} Days` : 'none');

export const documentsRouter = defineResource('/documents', {
  name: 'document',
  label: 'Document',
  module: 'documents',
  page: 'Add New Document',
  // "ECC-2026-001 (Environmental Clearance Certificate (ECC))"
  describe: (r) => show(r.documentNo, paren(r.documentName)),
  model: 'document',
  schema: documentSchema,
  search: ['documentName', 'documentNo', 'issuingAuthority'],
  // RP1-151 the register's filters: Category, Type, Status, Expiry From / To (YYYY-MM-DD).
  filters: [
    'category',
    'type',
    { name: 'status', where: (v) => statusWhere(v) },
    { name: 'expiryFrom', where: (v) => (validDate(v) ? { expiryDate: { gte: validDate(v) } } : {}) },
    { name: 'expiryTo', where: (v) => (validDate(v) ? { expiryDate: { lte: validDate(v) } } : {}) },
  ],
  refs: {
    category: { model: 'documentCategory', label: 'categoryName' },
    type: { model: 'documentType', label: 'typeName' },
  },
  files: ['attachment'],
  unique: ['documentNo'],
  // Soonest expiry first; documents without an expiry at the end.
  orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { documentNo: 'asc' }, { id: 'asc' }],
  check: async (values, id) => {
    const fields: Record<string, string> = {};
    const [type, category, before] = await Promise.all([
      db.documentType.findFirst({
        where: { id: String(values.type), deletedAt: null },
        select: { category: true, status: true },
      }),
      db.documentCategory.findFirst({
        where: { id: String(values.category), deletedAt: null },
        select: { status: true },
      }),
      id ? db.document.findUnique({ where: { id }, select: { category: true, type: true } }) : null,
    ]);
    if (type && type.category !== values.category)
      fields.type = 'This document type is not in the selected category.';
    // A new document, or one moved to another category or type, needs them Active.
    if (category && category.status !== 'ACTIVE' && before?.category !== values.category)
      fields.category = 'This category is Inactive.';
    if (type && type.status !== 'ACTIVE' && before?.type !== values.type)
      fields.type ??= 'This document type is Inactive.';

    const issue = values.issueDate instanceof Date ? values.issueDate : null;
    const expiry = values.expiryDate instanceof Date ? values.expiryDate : null;
    if (!expiry && values.renewalRequired === true)
      fields.expiryDate = 'Expiry Date is required when Renewal Required is on.';
    if (issue && expiry && expiry <= issue) fields.expiryDate = 'Must be after the Issue Date.';
    if (issue && expiry && expiry > issue && typeof values.validityMonths === 'number') {
      const months = monthsBetween(issue, expiry);
      if (values.validityMonths !== months)
        fields.validityMonths = `${VALIDATION_MONTHS} (${months} month${months === 1 ? '' : 's'}).`;
    }
    if (!expiry && typeof values.validityMonths === 'number')
      fields.validityMonths = 'Leave it empty when there is no Expiry Date.';

    const days = Array.isArray(values.reminderDays) ? (values.reminderDays as number[]) : [];
    if (values.reminderSetting === 'CUSTOM') {
      if (!days.length) fields.reminderDays = 'Enter at least one reminder day.';
      else if (days.some((d, i) => i > 0 && d >= (days[i - 1] ?? 0)))
        fields.reminderDays =
          'Enter the days largest first, each fewer than the one before (for example 60, 30, 7).';
    }

    if (typeof values.attachment === 'string') {
      const file = await db.storedFile.findUnique({
        where: { id: values.attachment },
        select: { type: true },
      });
      if (file && !ATTACHMENT_TYPES.includes(file.type)) fields.attachment = 'Use a PDF, JPG or PNG file.';
    }
    return fields;
  },
  /** Validity from the dates; custom days only with Custom; the day it turns Expiring Soon (RP1-151). */
  onSave: async (data) => {
    const issue = data.issueDate instanceof Date ? data.issueDate : null;
    const expiry = data.expiryDate instanceof Date ? data.expiryDate : null;
    const reminderDays = data.reminderSetting === 'CUSTOM' ? data.reminderDays : null;
    const type = await db.documentType.findUnique({
      where: { id: String(data.type) },
      select: { reminders: true, defaultReminderDays: true },
    });
    return {
      validityMonths: issue && expiry ? monthsBetween(issue, expiry) : null,
      reminderDays,
      expiringFrom: type
        ? expiringFromOf(expiry, windowDays({ reminderSetting: data.reminderSetting, reminderDays }, type))
        : null,
    };
  },
  /** The Reminder Settings text ("Use Default (90, 60, 30, 7 Days)") and the days that apply. */
  enrich: async (rows) => {
    const types = await db.documentType.findMany({
      where: { id: { in: [...new Set(rows.map((r) => String(r.type)))] } },
      select: { id: true, reminders: true, typeCode: true, autoStatusUpdate: true },
    });
    const on = today();
    return new Map(
      rows.map((r) => {
        const type = types.find((t) => t.id === r.type);
        const typeDays = enabledDays(type?.reminders);
        const custom = r.reminderSetting === 'CUSTOM' && Array.isArray(r.reminderDays);
        const days = custom ? (r.reminderDays as number[]) : typeDays;
        const status = statusOf(r, type?.autoStatusUpdate ?? true, on);
        const left = daysLeft(r.expiryDate instanceof Date ? r.expiryDate : null, on);
        return [
          r.id,
          {
            typeCode: type?.typeCode ?? null,
            status,
            statusLabel: statusLabel(status),
            daysLeft: left,
            // The badge: "12 days", or "Expired 15 days ago".
            daysLeftLabel:
              left === null
                ? null
                : left >= 0
                  ? `${left} day${left === 1 ? '' : 's'}`
                  : `Expired ${-left} days ago`,
            daysLeftLevel: daysLeftLevel(left),
            reminderSettingLabel: custom
              ? `Custom (${daysText(days)})`
              : `Use Default (${daysText(typeDays)})`,
            effectiveReminderDays: days,
          },
        ];
      }),
    );
  },
  /** The register's cards for the same filters: Total, Active, Expiring Soon, Expired, Inactive, Pending Approval. */
  summary: async (where) => {
    const on = today();
    const count = (status: string) => db.document.count({ where: { AND: [where, statusWhere(status, on)] } });
    const [total, active, expiringSoon, expired, inactive, pendingApproval] = await Promise.all([
      db.document.count({ where }),
      count('ACTIVE'),
      count('EXPIRING_SOON'),
      count('EXPIRED'),
      count('INACTIVE'),
      db.changeRequest.count({ where: { resource: 'document', status: 'pending' } }),
    ]);
    return { totalDocuments: total, active, expiringSoon, expired, inactive, pendingApproval };
  },
  export: {
    fileName: 'document-register',
    sheet: 'Document Register',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Document Name', value: (row) => row.documentName, width: 40 },
      { header: 'Category', value: (row) => row.categoryName, width: 28 },
      { header: 'Type', value: (row) => row.typeName, width: 32 },
      { header: 'Document No.', value: (row) => row.documentNo, width: 18 },
      { header: 'Issuing Authority', value: (row) => row.issuingAuthority, width: 32 },
      { header: 'Issue Date', value: (row) => isoDate(row.issueDate), width: 12 },
      { header: 'Expiry Date', value: (row) => isoDate(row.expiryDate), width: 12 },
      { header: 'Days Left', value: (row) => row.daysLeft, width: 10 },
      { header: 'Status', value: (row) => row.statusLabel, width: 14 },
    ],
  },
  options: { path: 'documents', label: (row) => `${String(row.documentNo)} — ${String(row.documentName)}` },
});

/** The form's Reminder Settings dropdown. The type's own values: `GET /document-types/:id/expiry-settings`. */
export const documentExtrasRouter = Router();
documentExtrasRouter.get('/form-options', (_req, res) => {
  res.json({
    reminderSettings: REMINDER_SETTINGS.map((o, i) => ({ id: i + 1, ...o })),
    attachmentTypes: ['PDF', 'JPG', 'PNG'],
    maxAttachmentMb: 10,
  });
});
/** RP1-151: the register's Status filter. Categories and types come from `/options/...`. */
documentExtrasRouter.get('/filter-options', (_req, res) => {
  res.json({ statuses: DOCUMENT_STATUSES.map((o, i) => ({ id: i + 1, ...o })) });
});
docsPaths['/documents/filter-options'] = {
  get: {
    tags: ['Document'],
    summary: 'Document Register filter options: statuses (ACTIVE, EXPIRING_SOON, EXPIRED, INACTIVE)',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
docsPaths['/documents/form-options'] = {
  get: {
    tags: ['Document'],
    summary: 'Add New Document form options: reminderSettings, attachmentTypes, maxAttachmentMb',
    responses: { '200': { description: 'Lists' } },
  },
};

/** RP1-148: live documents per category / type (Total Documents columns and delete guards). */
export async function documentCounts(by: 'category' | 'type', ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const groups = await db.document.groupBy({
    by: [by],
    where: { deletedAt: null, [by]: { in: ids } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [String(g[by]), g._count._all]));
}
