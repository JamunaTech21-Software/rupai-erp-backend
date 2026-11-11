import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { defineCustomWrite, pendingBadges, runCustomWrite, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { fileId, optDate, optText, reqDate } from '../../lib/fields.js';
import { writeHistory } from '../../lib/history.js';
import { newId } from '../../lib/ids.js';
import { currentUserId } from '../../lib/resource.js';
import { toJson } from '../../lib/serialize.js';
import { z } from '../../lib/validation.js';
import { zodFields } from '../../middleware/error-handler.js';
import { fileUrl } from '../files/service.js';
import { ATTACHMENT_TYPES, monthsBetween } from './documents.js';
import { expiringFromOf, today, windowDays } from './status.js';

/**
 * RP1-154 N.6 Renewal, Versions and Archive (`/documents-archive`). Renew: a new file and dates make the next
 * version; the type decides the validity (Same as Previous or Custom months), whether a renewal is allowed
 * (Allow Version Upload) and whether the replaced version is kept (Keep Previous Versions). Archive / Restore
 * take a document out of the register and the dashboard and back. All three go through approval (module
 * `documents`) as one request on the document.
 */
const VALIDATION = 'Please correct the highlighted fields.';

const renewSchema = z.object({
  issueDate: reqDate(),
  expiryDate: optDate(),
  attachment: fileId().refine((v) => v !== null, 'Upload the renewed document.'),
  documentNo: optText(60),
  issuingAuthority: optText(200),
  remarks: optText(1000),
});

const addMonths = (d: Date, months: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function loadDocument(id: string) {
  const doc = await db.document.findFirst({
    where: { id, deletedAt: null },
    include: {
      typeRef: {
        select: {
          typeName: true,
          renewalValidity: true,
          renewalValidityMonths: true,
          allowVersionUpload: true,
          keepPreviousVersions: true,
          reminders: true,
          defaultReminderDays: true,
        },
      },
    },
  });
  if (!doc) throw notFound('Document');
  return doc;
}
type LoadedDocument = Awaited<ReturnType<typeof loadDocument>>;

/** Months a renewal runs: the type's Custom months, else the same as the current version. */
const renewalMonths = (doc: LoadedDocument) =>
  doc.typeRef.renewalValidity === 'CUSTOM' ? doc.typeRef.renewalValidityMonths : doc.validityMonths;

/** The version values a renewal replaces (also the request's "before"). */
const current = (doc: LoadedDocument) => ({
  version: doc.version,
  documentNo: doc.documentNo,
  issuingAuthority: doc.issuingAuthority,
  issueDate: iso(doc.issueDate),
  expiryDate: iso(doc.expiryDate),
  validityMonths: doc.validityMonths,
  attachment: doc.attachment,
  remarks: doc.remarks,
});

const renewWrite = defineCustomWrite({
  key: 'documentRenew',
  module: 'documents',
  resource: 'document',
  page: 'Document Renewal',
  plan: async ({ params, body }) => {
    const doc = await loadDocument(params.id ?? '');
    if (doc.archivedAt)
      throw new AppError('VALIDATION', VALIDATION, {
        document: 'This document is archived. Restore it first.',
      });
    if (!doc.typeRef.allowVersionUpload)
      throw new AppError('VALIDATION', VALIDATION, {
        document: `${doc.typeRef.typeName} does not allow new versions (Expiry & Renewal settings).`,
      });
    const parsed = renewSchema.safeParse(body ?? {});
    if (!parsed.success) throw new AppError('VALIDATION', VALIDATION, zodFields(parsed.error));
    const v = parsed.data;
    const fields: Record<string, string> = {};
    const months = renewalMonths(doc);
    const expiry = v.expiryDate ?? (months ? addMonths(v.issueDate, months) : null);
    if (!expiry && doc.renewalRequired) fields.expiryDate = 'Enter the Expiry Date.';
    if (expiry && expiry <= v.issueDate) fields.expiryDate = 'Must be after the Issue Date.';
    const documentNo = v.documentNo ?? doc.documentNo;
    if (documentNo.toLowerCase() !== doc.documentNo.toLowerCase()) {
      const taken = await db.document.count({ where: { documentNo, deletedAt: null, NOT: { id: doc.id } } });
      if (taken) fields.documentNo = 'This Document No. is already used.';
    }
    const file = await db.storedFile.findUnique({
      where: { id: String(v.attachment) },
      select: { type: true },
    });
    if (!file) fields.attachment = 'Upload the file again.';
    else if (!ATTACHMENT_TYPES.includes(file.type)) fields.attachment = 'Use a PDF, JPG or PNG file.';
    else if (v.attachment === doc.attachment) fields.attachment = 'Upload the renewed document.';
    if (Object.keys(fields).length) throw new AppError('VALIDATION', VALIDATION, fields);

    const before = current(doc);
    const next = {
      version: doc.version + 1,
      documentNo,
      issuingAuthority: v.issuingAuthority ?? doc.issuingAuthority,
      issueDate: iso(v.issueDate),
      expiryDate: iso(expiry),
      validityMonths: expiry ? monthsBetween(v.issueDate, expiry) : null,
      attachment: v.attachment,
      remarks: v.remarks ?? doc.remarks,
    };
    return {
      recordId: doc.id,
      summary: `Renewal: ${show(doc.documentNo)} (${doc.documentName}) to version ${next.version}`,
      oldData: before,
      newData: next,
      run: async (tx, userId, approvalId) => {
        if (doc.typeRef.keepPreviousVersions)
          await tx.documentVersion.create({
            data: {
              id: newId(),
              documentId: doc.id,
              version: doc.version,
              documentNo: doc.documentNo,
              issuingAuthority: doc.issuingAuthority,
              issueDate: doc.issueDate,
              expiryDate: doc.expiryDate,
              validityMonths: doc.validityMonths,
              attachment: doc.attachment,
              replacedBy: userId,
              approvalId,
            },
          });
        await tx.document.update({
          where: { id: doc.id },
          data: {
            ...next,
            issueDate: v.issueDate,
            expiryDate: expiry,
            expiringFrom: expiringFromOf(expiry, windowDays(doc, doc.typeRef)),
            updatedBy: userId,
          },
        });
        await writeHistory(tx, {
          resource: 'document',
          recordId: doc.id,
          action: 'update',
          oldData: before,
          newData: next,
          userId,
          approvalId,
        });
      },
    };
  },
});

const archiveWrite = (archive: boolean) =>
  defineCustomWrite({
    key: archive ? 'documentArchive' : 'documentUnarchive',
    module: 'documents',
    resource: 'document',
    page: archive ? 'Document Archive' : 'Document Restore',
    plan: async ({ params }) => {
      const doc = await loadDocument(params.id ?? '');
      if (archive && doc.archivedAt)
        throw new AppError('VALIDATION', VALIDATION, { document: 'This document is already archived.' });
      if (!archive && !doc.archivedAt)
        throw new AppError('VALIDATION', VALIDATION, { document: 'This document is not archived.' });
      const before = { archived: !archive };
      const after = { archived: archive };
      return {
        recordId: doc.id,
        summary: `${archive ? 'Archive' : 'Restore'}: ${show(doc.documentNo)} (${doc.documentName})`,
        oldData: before,
        newData: after,
        run: async (tx, userId, approvalId) => {
          await tx.document.update({
            where: { id: doc.id },
            data: archive
              ? { archivedAt: new Date(), archivedBy: userId, updatedBy: userId }
              : { archivedAt: null, archivedBy: null, updatedBy: userId },
          });
          await writeHistory(tx, {
            resource: 'document',
            recordId: doc.id,
            action: 'update',
            oldData: before,
            newData: after,
            userId,
            approvalId,
          });
        },
      };
    },
  });
const archive = archiveWrite(true);
const unarchive = archiveWrite(false);

// ---- Lists ------------------------------------------------------------------------------------------------

const query = (req: { query: Record<string, unknown> }) => {
  const q = (k: string) => (typeof req.query[k] === 'string' ? req.query[k].trim() : '');
  return {
    q,
    page: Math.max(1, Number.parseInt(q('page'), 10) || 1),
    perPage: Math.min(100, Math.max(1, Number.parseInt(q('perPage'), 10) || 10)),
  };
};
const meta = (page: number, perPage: number, total: number) => ({
  page,
  perPage,
  total,
  totalPages: Math.max(1, Math.ceil(total / perPage)),
});

async function names(userIds: (string | null)[], fileIds: (string | null)[]) {
  const [users, files] = await Promise.all([
    db.user.findMany({
      where: { id: { in: [...new Set(userIds.filter((x): x is string => !!x))] } },
      select: { id: true, name: true },
    }),
    db.storedFile.findMany({
      where: { id: { in: [...new Set(fileIds.filter((x): x is string => !!x))] } },
      select: { id: true, name: true },
    }),
  ]);
  return {
    user: (id: string | null) => users.find((u) => u.id === id)?.name ?? null,
    file: (id: string | null) =>
      id
        ? { attachmentUrl: fileUrl(id), attachmentName: files.find((f) => f.id === id)?.name ?? null }
        : {
            attachmentUrl: null,
            attachmentName: null,
          },
  };
}

export const documentRenewalRouter = Router();

/** The Archive page: archived documents, newest first; search, Category and Type filters. */
documentRenewalRouter.get('/archive', async (req, res) => {
  const { q, page, perPage } = query(req);
  const search = q('search');
  const where = {
    deletedAt: null,
    archivedAt: { not: null },
    ...(q('category') ? { category: q('category') } : {}),
    ...(q('type') ? { type: q('type') } : {}),
    ...(search ? { OR: [{ documentName: { contains: search } }, { documentNo: { contains: search } }] } : {}),
  };
  const [total, docs] = await Promise.all([
    db.document.count({ where }),
    db.document.findMany({
      where,
      include: { categoryRef: { select: { categoryName: true } }, typeRef: { select: { typeName: true } } },
      orderBy: [{ archivedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);
  const n = await names(
    docs.map((d) => d.archivedBy),
    docs.map((d) => d.attachment),
  );
  const badges = await pendingBadges(
    'document',
    docs.map((d) => d.id),
  );
  res.json(
    toJson({
      data: docs.map((d) => ({
        id: d.id,
        documentName: d.documentName,
        documentNo: d.documentNo,
        category: d.category,
        categoryName: d.categoryRef.categoryName,
        type: d.type,
        typeName: d.typeRef.typeName,
        version: d.version,
        issueDate: d.issueDate,
        expiryDate: d.expiryDate,
        archivedAt: d.archivedAt,
        archivedByName: n.user(d.archivedBy),
        ...n.file(d.attachment),
        pendingRequest: badges.get(d.id) ?? null,
      })),
      meta: meta(page, perPage, total),
    }),
  );
});

/** Replaced versions of every document, newest first; search, Category, Type and document filters. */
documentRenewalRouter.get('/versions', async (req, res) => {
  const { q, page, perPage } = query(req);
  const search = q('search');
  const where = {
    document: {
      deletedAt: null,
      ...(q('category') ? { category: q('category') } : {}),
      ...(q('type') ? { type: q('type') } : {}),
    },
    ...(q('document') ? { documentId: q('document') } : {}),
    ...(search
      ? { OR: [{ documentNo: { contains: search } }, { document: { documentName: { contains: search } } }] }
      : {}),
  };
  const [total, versions] = await Promise.all([
    db.documentVersion.count({ where }),
    db.documentVersion.findMany({
      where,
      include: {
        document: {
          select: {
            documentName: true,
            documentNo: true,
            categoryRef: { select: { categoryName: true } },
            typeRef: { select: { typeName: true } },
          },
        },
      },
      orderBy: [{ replacedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);
  const n = await names(
    versions.map((v) => v.replacedBy),
    versions.map((v) => v.attachment),
  );
  res.json(
    toJson({
      data: versions.map((v) => ({
        id: v.id,
        documentId: v.documentId,
        documentName: v.document.documentName,
        currentDocumentNo: v.document.documentNo,
        categoryName: v.document.categoryRef.categoryName,
        typeName: v.document.typeRef.typeName,
        version: v.version,
        documentNo: v.documentNo,
        issuingAuthority: v.issuingAuthority,
        issueDate: v.issueDate,
        expiryDate: v.expiryDate,
        validityMonths: v.validityMonths,
        replacedAt: v.replacedAt,
        replacedByName: n.user(v.replacedBy),
        ...n.file(v.attachment),
      })),
      meta: meta(page, perPage, total),
    }),
  );
});

/** One document's versions: the current one first, then the kept ones. */
documentRenewalRouter.get('/:id/versions', async (req, res) => {
  const doc = await loadDocument(req.params.id);
  const kept = await db.documentVersion.findMany({
    where: { documentId: doc.id },
    orderBy: { version: 'desc' },
  });
  const n = await names(
    [doc.updatedBy, ...kept.map((v) => v.replacedBy)],
    [doc.attachment, ...kept.map((v) => v.attachment)],
  );
  res.json(
    toJson([
      {
        version: doc.version,
        isCurrent: true,
        documentNo: doc.documentNo,
        issuingAuthority: doc.issuingAuthority,
        issueDate: doc.issueDate,
        expiryDate: doc.expiryDate,
        validityMonths: doc.validityMonths,
        replacedAt: null,
        replacedByName: null,
        ...n.file(doc.attachment),
      },
      ...kept.map((v) => ({
        version: v.version,
        isCurrent: false,
        documentNo: v.documentNo,
        issuingAuthority: v.issuingAuthority,
        issueDate: v.issueDate,
        expiryDate: v.expiryDate,
        validityMonths: v.validityMonths,
        replacedAt: v.replacedAt,
        replacedByName: n.user(v.replacedBy),
        ...n.file(v.attachment),
      })),
    ]),
  );
});

/** The Renew form's starting values: issue today, expiry from the type's renewal validity. */
documentRenewalRouter.get('/:id/renewal-defaults', async (req, res) => {
  const doc = await loadDocument(req.params.id);
  const issue = today();
  const months = renewalMonths(doc);
  const expiry = months ? addMonths(issue, months) : null;
  res.json({
    documentId: doc.id,
    currentVersion: doc.version,
    nextVersion: doc.version + 1,
    allowVersionUpload: doc.typeRef.allowVersionUpload,
    keepPreviousVersions: doc.typeRef.keepPreviousVersions,
    renewalValidity: doc.typeRef.renewalValidity,
    validityMonths: months,
    issueDate: iso(issue),
    expiryDate: iso(expiry),
    documentNo: doc.documentNo,
    issuingAuthority: doc.issuingAuthority,
    archived: doc.archivedAt !== null,
  });
});

const answer = async (id: string) => {
  const doc = await loadDocument(id);
  return toJson({ id: doc.id, version: doc.version, archivedAt: doc.archivedAt, documentNo: doc.documentNo });
};

documentRenewalRouter.post('/:id/renew', async (req, res) => {
  const { queued } = await runCustomWrite(
    renewWrite,
    { params: { id: req.params.id }, body: req.body, action: 'update' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  res.json(await answer(req.params.id));
});
documentRenewalRouter.post('/:id/archive', async (req, res) => {
  const { queued } = await runCustomWrite(
    archive,
    { params: { id: req.params.id }, body: {}, action: 'update' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  res.json(await answer(req.params.id));
});
documentRenewalRouter.post('/:id/unarchive', async (req, res) => {
  const { queued } = await runCustomWrite(
    unarchive,
    { params: { id: req.params.id }, body: {}, action: 'update' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  res.json(await answer(req.params.id));
});

const tags = ['Document renewal and archive'];
const write = (summary: string) => ({
  post: {
    tags,
    summary,
    responses: { '200': { description: 'Done' }, '202': { description: 'Sent for approval' } },
  },
});
docsPaths['/documents/archive'] = {
  get: {
    tags,
    summary: 'Archived documents (page, perPage, search, category, type)',
    responses: { '200': { description: '{ data, meta }' } },
  },
};
docsPaths['/documents/versions'] = {
  get: {
    tags,
    summary: 'Replaced versions (page, perPage, search, category, type, document)',
    responses: { '200': { description: '{ data, meta }' } },
  },
};
docsPaths['/documents/{id}/versions'] = {
  get: {
    tags,
    summary: "A document's versions, current first",
    responses: { '200': { description: 'List' } },
  },
};
docsPaths['/documents/{id}/renewal-defaults'] = {
  get: { tags, summary: 'Renew form starting values', responses: { '200': { description: 'Values' } } },
};
docsPaths['/documents/{id}/renew'] = write(
  'Renew: { issueDate, expiryDate?, attachment, documentNo?, issuingAuthority?, remarks? }',
);
docsPaths['/documents/{id}/archive'] = write('Archive a document');
docsPaths['/documents/{id}/unarchive'] = write('Restore an archived document');
