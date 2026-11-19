import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { Prisma } from '../../generated/prisma/client.js';
import { defineCustomWrite, refuseIfOpen, requestNo, runCustomWrite, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { fileId, oneOf, optText, reqDate } from '../../lib/fields.js';
import { writeHistory } from '../../lib/history.js';
import { newId } from '../../lib/ids.js';
import { currentUserId } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { zodFields } from '../../middleware/error-handler.js';
import { fileUrl } from '../files/service.js';
import { resolveDocumentNotifications } from '../notifications/reminders.js';
import {
  ATTACHMENT_TYPES,
  REMINDER_SETTINGS,
  daysText,
  enabledDays,
  isoDate,
  monthsBetween,
  reminderDaysField,
  reminderDaysProblem,
} from './documents.js';
import { expiringFromOf, statusLabel, statusOf, today, windowDays } from './status.js';

/**
 * RP1-197 N.7 Document Renewal (Document Register "Renew" button and pop-up; Expiry & Renewal Setting
 * Renewal Rules 3-5). Only an Expired or Expiring Soon document is renewed. The pop-up shows the document
 * read-only with its Old Issued Date and Old Expiry Date; it changes Issuing Authority, Issue Date, Expiry Date,
 * Reminder Setting and, when the type allows a new version, the Attachment. Saving writes one
 * `document_renewals` row (old and new values, old file kept) and gives the document the new values, so its
 * status, Days Left and the cards follow. With Documents approval On it waits for approval like an edit (one
 * open request per document).
 */
const RENEWABLE = ['EXPIRED', 'EXPIRING_SOON'];
const NOT_RENEWABLE = 'Only an Expired or Expiring Soon document can be renewed.';
const NO_NEW_FILE = 'This document type does not allow a new file on renewal.';

const renewSchema = z.object({
  issuingAuthority: optText(200).optional(),
  issueDate: reqDate(),
  expiryDate: reqDate(),
  reminderSetting: oneOf(REMINDER_SETTINGS.map((o) => o.value)),
  reminderDays: reminderDaysField(),
  attachment: fileId().optional(),
});

const reminderLabel = (setting: unknown, days: unknown, typeDays: number[]) =>
  setting === 'CUSTOM' && Array.isArray(days)
    ? `Custom (${daysText(days as number[])})`
    : `Use Default (${daysText(typeDays)})`;

/** The date `months` whole months after `from` (31 Jan + 1 = 28/29 Feb). */
export function addMonths(from: Date, months: number) {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(from.getUTCDate(), last)));
}

async function liveDocument(id: string) {
  const doc = await db.document.findFirst({
    where: { id, deletedAt: null },
    include: {
      typeRef: {
        select: {
          typeName: true,
          reminders: true,
          defaultReminderDays: true,
          autoStatusUpdate: true,
          renewalValidity: true,
          renewalValidityMonths: true,
          allowVersionUpload: true,
        },
      },
      categoryRef: { select: { categoryName: true } },
    },
  });
  if (!doc) throw notFound('Document');
  return doc;
}
type LiveDocument = Awaited<ReturnType<typeof liveDocument>>;

const statusOfDoc = (doc: LiveDocument) => statusOf(doc, doc.typeRef.autoStatusUpdate);

/** Months the renewal runs: the type's Renewal Validity (custom months, or the same period as before). */
function renewalMonths(doc: LiveDocument) {
  if (doc.typeRef.renewalValidity === 'CUSTOM' && doc.typeRef.renewalValidityMonths)
    return doc.typeRef.renewalValidityMonths;
  if (doc.validityMonths) return doc.validityMonths;
  return doc.expiryDate ? Math.max(1, monthsBetween(doc.issueDate, doc.expiryDate)) : 12;
}

/** What the renewal changes, as saved now: the request's old values (a change since then makes it stale). */
const snapshot = (doc: LiveDocument) => ({
  issueDate: isoDate(doc.issueDate),
  expiryDate: isoDate(doc.expiryDate),
  issuingAuthority: doc.issuingAuthority,
  reminderSetting: doc.reminderSetting,
  reminderDays: doc.reminderDays ?? null,
  attachment: doc.attachment,
  validityMonths: doc.validityMonths,
  updatedAt: doc.updatedAt.toISOString(),
});

const renewWrite = defineCustomWrite({
  key: 'documentRenewal',
  module: 'documents',
  // As an edit of the document: a renewal and an edit cannot both wait at once.
  resource: 'document',
  page: 'Document Renewal',
  plan: async ({ params, body }) => {
    const doc = await liveDocument(params.id ?? '');
    if (!RENEWABLE.includes(statusOfDoc(doc))) throw new AppError('VALIDATION', NOT_RENEWABLE);

    const parsed = renewSchema.safeParse(body ?? {});
    const fields: Record<string, string> = parsed.success ? {} : zodFields(parsed.error);
    const v = parsed.success ? parsed.data : null;
    if (v) {
      const issue = v.issueDate;
      const expiry = v.expiryDate;
      if (issue < doc.issueDate)
        fields.issueDate = `Must be on or after the Old Issued Date (${isoDate(doc.issueDate)}).`;
      if (expiry <= issue) fields.expiryDate = 'Must be after the Issue Date.';
      else if (doc.expiryDate && expiry <= doc.expiryDate)
        fields.expiryDate = `Must be after the Old Expiry Date (${isoDate(doc.expiryDate)}).`;
      const reminder = reminderDaysProblem(v.reminderSetting, v.reminderDays);
      if (reminder) fields.reminderDays = reminder;
      if (typeof v.attachment === 'string' && v.attachment !== doc.attachment) {
        if (!doc.typeRef.allowVersionUpload) fields.attachment = NO_NEW_FILE;
        else {
          const file = await db.storedFile.findUnique({
            where: { id: v.attachment },
            select: { type: true },
          });
          if (!file) fields.attachment = 'Upload the file again.';
          else if (!ATTACHMENT_TYPES.includes(file.type)) fields.attachment = 'Use a PDF, JPG or PNG file.';
        }
      }
    }
    if (!v || Object.keys(fields).length)
      throw new AppError('VALIDATION', 'Please correct the highlighted fields.', fields);

    const issue = v.issueDate;
    const expiry = v.expiryDate;
    const reminderDays = v.reminderSetting === 'CUSTOM' ? (v.reminderDays ?? null) : null;
    const newFile = typeof v.attachment === 'string' && v.attachment !== doc.attachment ? v.attachment : null;
    const values = {
      issueDate: issue,
      expiryDate: expiry,
      // Left out: the authority stays as it was.
      issuingAuthority: v.issuingAuthority === undefined ? doc.issuingAuthority : v.issuingAuthority,
      reminderSetting: v.reminderSetting,
      reminderDays,
      attachment: newFile ?? doc.attachment,
      validityMonths: monthsBetween(issue, expiry),
    };
    const before = snapshot(doc);
    return {
      recordId: doc.id,
      summary: `${show(doc.documentNo, `(${doc.documentName})`)}: expiry ${before.expiryDate ?? '—'} → ${isoDate(expiry)}`,
      oldData: before,
      newData: {
        ...values,
        issueDate: isoDate(issue),
        expiryDate: isoDate(expiry),
      },
      run: async (tx, userId, approvalId) => {
        const renewalId = newId();
        await tx.document.update({
          where: { id: doc.id },
          data: {
            ...values,
            reminderDays: values.reminderDays ?? Prisma.DbNull,
            expiringFrom: expiringFromOf(expiry, windowDays(values, doc.typeRef)),
            updatedBy: userId,
          },
        });
        // RP1-201: its expiry reminders no longer apply.
        await resolveDocumentNotifications(tx, doc.id);
        await tx.documentRenewal.create({
          data: {
            id: renewalId,
            document: doc.id,
            oldIssueDate: doc.issueDate,
            oldExpiryDate: doc.expiryDate,
            newIssueDate: issue,
            newExpiryDate: expiry,
            oldIssuingAuthority: doc.issuingAuthority,
            issuingAuthority: values.issuingAuthority,
            oldReminderSetting: doc.reminderSetting,
            oldReminderDays: doc.reminderDays ?? Prisma.DbNull,
            reminderSetting: values.reminderSetting,
            reminderDays: values.reminderDays ?? Prisma.DbNull,
            oldAttachment: doc.attachment,
            newAttachment: newFile,
            approvalId,
            createdBy: userId,
            updatedBy: userId,
          },
        });
        const { updatedAt: _u, ...old } = before;
        await writeHistory(tx, {
          resource: 'document',
          recordId: doc.id,
          action: 'update',
          oldData: old,
          newData: { ...values, issueDate: isoDate(issue), expiryDate: isoDate(expiry), renewal: renewalId },
          userId,
          approvalId,
        });
        return renewalId;
      },
    };
  },
});

/** One renewal as the Renewal History shows it. */
async function presentRenewals(
  rows: Awaited<ReturnType<typeof db.documentRenewal.findMany>>,
  typeDays: number[],
) {
  const ids = [
    ...new Set(rows.flatMap((r) => [r.oldAttachment, r.newAttachment]).filter((x): x is string => !!x)),
  ];
  const userIds = [...new Set(rows.map((r) => r.createdBy))];
  const approvalIds = rows.map((r) => r.approvalId).filter((x): x is string => !!x);
  const [files, users, approvals] = await Promise.all([
    ids.length
      ? db.storedFile.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [],
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    approvalIds.length
      ? db.changeRequest.findMany({ where: { id: { in: approvalIds } }, select: { id: true, seq: true } })
      : [],
  ]);
  const file = (id: string | null) =>
    id ? { id, name: files.find((f) => f.id === id)?.name ?? null, url: fileUrl(id) } : null;
  return rows.map((r) => ({
    id: r.id,
    renewedAt: r.createdAt.toISOString(),
    renewedBy: { id: r.createdBy, name: users.find((u) => u.id === r.createdBy)?.name ?? 'Unknown' },
    requestNo: (() => {
      const a = approvals.find((x) => x.id === r.approvalId);
      return a ? requestNo(a.seq) : null;
    })(),
    oldIssueDate: isoDate(r.oldIssueDate),
    oldExpiryDate: isoDate(r.oldExpiryDate),
    newIssueDate: isoDate(r.newIssueDate),
    newExpiryDate: isoDate(r.newExpiryDate),
    oldIssuingAuthority: r.oldIssuingAuthority,
    issuingAuthority: r.issuingAuthority,
    oldReminderSettingLabel: reminderLabel(r.oldReminderSetting, r.oldReminderDays, typeDays),
    reminderSettingLabel: reminderLabel(r.reminderSetting, r.reminderDays, typeDays),
    oldAttachment: file(r.oldAttachment),
    // Null when the old file was kept.
    newAttachment: file(r.newAttachment),
  }));
}

export const documentRenewalRouter = Router();

/** The pop-up: the document read-only, the old dates, the editable values and a suggested new period. */
documentRenewalRouter.get('/:id/renew-form', async (req, res) => {
  const doc = await liveDocument(req.params.id);
  const status = statusOfDoc(doc);
  const pending = await db.changeRequest.findFirst({
    where: { resource: 'document', recordId: doc.id, status: 'pending' },
    select: { seq: true },
  });
  const months = renewalMonths(doc);
  const issue = today();
  const typeDays = enabledDays(doc.typeRef.reminders);
  let suggestedExpiry = addMonths(issue, months);
  if (doc.expiryDate && suggestedExpiry <= doc.expiryDate)
    suggestedExpiry = addMonths(doc.expiryDate, months);
  const reason = !RENEWABLE.includes(status)
    ? NOT_RENEWABLE
    : pending
      ? `This document already has a pending request (${requestNo(pending.seq)}).`
      : null;
  res.json({
    id: doc.id,
    canRenew: reason === null,
    reason,
    // Read-only.
    categoryName: doc.categoryRef.categoryName,
    typeName: doc.typeRef.typeName,
    documentName: doc.documentName,
    documentNo: doc.documentNo,
    validityMonths: doc.validityMonths,
    renewalRequired: doc.renewalRequired,
    remarks: doc.remarks,
    status,
    statusLabel: statusLabel(status),
    oldIssueDate: isoDate(doc.issueDate),
    oldExpiryDate: isoDate(doc.expiryDate),
    attachment: doc.attachment,
    attachmentName: doc.attachment
      ? ((await db.storedFile.findUnique({ where: { id: doc.attachment }, select: { name: true } }))?.name ??
        null)
      : null,
    attachmentUrl: doc.attachment ? fileUrl(doc.attachment) : null,
    // Editable, pre-filled.
    issuingAuthority: doc.issuingAuthority,
    reminderSetting: doc.reminderSetting,
    reminderDays: doc.reminderDays ?? null,
    typeReminderDays: typeDays,
    allowNewAttachment: doc.typeRef.allowVersionUpload,
    // New Expiry Date = Issue Date + renewalMonths (the type's Renewal Validity); the page may recount it.
    renewalValidity: doc.typeRef.renewalValidity,
    renewalMonths: months,
    suggestedIssueDate: isoDate(issue),
    suggestedExpiryDate: isoDate(suggestedExpiry),
  });
});

documentRenewalRouter.post('/:id/renew', async (req, res) => {
  await liveDocument(req.params.id);
  await refuseIfOpen('document', req.params.id);
  const { queued, result } = await runCustomWrite(
    renewWrite,
    { params: req.params, body: req.body, action: 'update' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  const doc = await liveDocument(req.params.id);
  const [renewal] = await presentRenewals(
    await db.documentRenewal.findMany({ where: { id: String(result) } }),
    enabledDays(doc.typeRef.reminders),
  );
  const status = statusOfDoc(doc);
  res.status(201).json({
    renewal,
    document: {
      id: doc.id,
      issueDate: isoDate(doc.issueDate),
      expiryDate: isoDate(doc.expiryDate),
      issuingAuthority: doc.issuingAuthority,
      validityMonths: doc.validityMonths,
      reminderSetting: doc.reminderSetting,
      reminderDays: doc.reminderDays ?? null,
      attachment: doc.attachment,
      status,
      statusLabel: statusLabel(status),
    },
  });
});

/** Renewal History on the document view, newest first. */
documentRenewalRouter.get('/:id/renewals', async (req, res) => {
  const doc = await db.document.findFirst({
    where: { id: req.params.id },
    select: { id: true, typeRef: { select: { reminders: true } } },
  });
  if (!doc) throw notFound('Document');
  const rows = await db.documentRenewal.findMany({
    where: { document: doc.id, deletedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  res.json({ data: await presentRenewals(rows, enabledDays(doc.typeRef.reminders)) });
});

const idParam = [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }];
const tags = ['Document'];
docsPaths['/documents/{id}/renew-form'] = {
  get: {
    tags,
    summary: 'Renew pop-up: read-only document, Old Issued / Expiry Date, pre-filled values, suggested dates',
    parameters: idParam,
    responses: {
      '200': {
        description:
          '{ canRenew, reason, categoryName, typeName, documentName, documentNo, validityMonths, renewalRequired, remarks, status, oldIssueDate, oldExpiryDate, attachment, attachmentName, attachmentUrl, issuingAuthority, reminderSetting, reminderDays, typeReminderDays, allowNewAttachment, renewalValidity, renewalMonths, suggestedIssueDate, suggestedExpiryDate }',
      },
      '404': { description: 'Not found' },
    },
  },
};
docsPaths['/documents/{id}/renew'] = {
  post: {
    tags,
    summary: 'Renew an Expired or Expiring Soon document (202 when Documents approval is On)',
    description:
      'Body: { issuingAuthority, issueDate*, expiryDate*, reminderSetting* (DEFAULT | CUSTOM), reminderDays (CUSTOM), attachment (new file id, optional) }. Issue Date on or after the Old Issued Date; Expiry Date after the Issue Date and after the Old Expiry Date.',
    parameters: idParam,
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['issueDate', 'expiryDate', 'reminderSetting'],
            properties: {
              issuingAuthority: { type: ['string', 'null'], maxLength: 200 },
              issueDate: { type: 'string', format: 'date' },
              expiryDate: { type: 'string', format: 'date' },
              reminderSetting: { type: 'string', enum: REMINDER_SETTINGS.map((o) => o.value) },
              reminderDays: { type: ['array', 'null'], items: { type: 'integer' } },
              attachment: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
    responses: {
      '201': { description: '{ renewal, document }' },
      '202': { description: 'Sent for approval' },
      '400': { description: 'error.fields, or the document is not Expired / Expiring Soon' },
      '404': { description: 'Not found' },
      '409': { description: 'The document already has a pending request' },
    },
  },
};
docsPaths['/documents/{id}/renewals'] = {
  get: {
    tags,
    summary: 'Renewal History, newest first',
    parameters: idParam,
    responses: {
      '200': {
        description:
          '{ data: [{ id, renewedAt, renewedBy, requestNo, oldIssueDate, oldExpiryDate, newIssueDate, newExpiryDate, oldIssuingAuthority, issuingAuthority, oldReminderSettingLabel, reminderSettingLabel, oldAttachment, newAttachment }] }',
      },
    },
  },
};
