import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { type PendingBadge, defineCustomWrite, pendingBadges, runCustomWrite } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { writeHistory } from '../../lib/history.js';
import { currentUserId } from '../../lib/resource.js';
import { toJson } from '../../lib/serialize.js';
import { type z } from '../../lib/validation.js';
import { zodFields } from '../../middleware/error-handler.js';
import {
  ESCALATION_DAY_CHOICES,
  REMINDER_DAY_CHOICES,
  REMINDER_NAMES,
  REMINDER_VALUE_CHOICES,
  RENEWAL_VALIDITY,
  SETTINGS_ID,
  UNITS,
  checkGlobal,
  checkTypeExpiry,
  globalSchema,
  globalSettings,
  typeExpirySchema,
} from './expiry.js';

/**
 * RP1-145 N.3 Expiry & Renewal (`/documents-expiry-renewal`, images 4 and 5). The top "Edit Settings" saves
 * the global settings (Basic Settings, Reminder Schedule, Notification Channels); a row's "Edit" saves one
 * document type's own values. Both go through approval (module `documents`) like any other save. The Renewal
 * Rules box is fixed text on the page.
 */
const VALIDATION = 'Please correct the highlighted fields.';
const TYPE_FIELDS = [
  'defaultReminderDays',
  'escalationDays',
  'renewalRequired',
  'autoStatusUpdate',
  'renewalValidity',
  'renewalValidityMonths',
  'allowVersionUpload',
  'keepPreviousVersions',
  'notifyResponsible',
  'reminders',
] as const;

function parse<S extends z.ZodType>(
  schema: S,
  body: unknown,
  extra: (v: z.infer<S>) => Record<string, string>,
) {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new AppError('VALIDATION', VALIDATION, zodFields(parsed.error));
  const fields = extra(parsed.data);
  if (Object.keys(fields).length) throw new AppError('VALIDATION', VALIDATION, fields);
  return parsed.data;
}

const globalWrite = defineCustomWrite({
  key: 'documentSettings',
  module: 'documents',
  resource: 'documentSettings',
  page: 'Expiry & Renewal Settings',
  plan: async ({ body }) => {
    const values = parse(globalSchema, body, checkGlobal);
    const before = await db.documentSettings.findUnique({ where: { id: SETTINGS_ID } });
    const oldData = before ? toJson({ ...before, updatedAt: undefined, updatedBy: undefined }) : null;
    return {
      recordId: SETTINGS_ID,
      summary: 'Global expiry and renewal settings',
      oldData,
      newData: values,
      run: async (tx, userId, approvalId) => {
        await tx.documentSettings.upsert({
          where: { id: SETTINGS_ID },
          create: { id: SETTINGS_ID, ...values, updatedBy: userId },
          update: { ...values, updatedBy: userId },
        });
        await writeHistory(tx, {
          resource: 'documentSettings',
          recordId: SETTINGS_ID,
          action: before ? 'update' : 'create',
          oldData: oldData ?? undefined,
          newData: values,
          userId,
          approvalId,
        });
      },
    };
  },
});

async function liveType(id: string) {
  const type = await db.documentType.findFirst({
    where: { id, deletedAt: null },
    include: { categoryRef: { select: { categoryName: true } } },
  });
  if (!type) throw notFound('Document type');
  return type;
}
const pick = (row: Record<string, unknown>) =>
  Object.fromEntries(TYPE_FIELDS.map((k) => [k, row[k] ?? null]));

const typeWrite = defineCustomWrite({
  key: 'documentTypeExpiry',
  module: 'documents',
  // The type's own record, so a type edit and an expiry edit cannot wait at the same time.
  resource: 'documentType',
  page: 'Expiry & Renewal Settings',
  plan: async ({ params, body }) => {
    const type = await liveType(params.id ?? '');
    const values = parse(typeExpirySchema, body, checkTypeExpiry);
    const next = {
      ...values,
      renewalValidityMonths: values.renewalValidity === 'CUSTOM' ? values.renewalValidityMonths : null,
    };
    const oldData = toJson(pick(type));
    return {
      recordId: type.id,
      summary: `${type.typeName} (${type.categoryRef.categoryName})`,
      oldData,
      newData: next,
      run: async (tx, userId, approvalId) => {
        await tx.documentType.update({ where: { id: type.id }, data: { ...next, updatedBy: userId } });
        await writeHistory(tx, {
          resource: 'documentType',
          recordId: type.id,
          action: 'update',
          oldData,
          newData: next,
          userId,
          approvalId,
        });
      },
    };
  },
});

/** One type's expiry values, as the image 5 form and the list show them. */
function typeRow(type: Awaited<ReturnType<typeof liveType>>, badge: PendingBadge | null) {
  return {
    id: type.id,
    typeCode: type.typeCode,
    typeName: type.typeName,
    category: type.category,
    categoryName: type.categoryRef.categoryName,
    status: type.status,
    ...pick(type),
    pendingRequest: badge,
  };
}

// ---- Global settings: /document-settings ------------------------------------------------------------------

export const documentSettingsRouter = Router();

documentSettingsRouter.get('/filter-options', (_req, res) => {
  const numbered = (list: { value: string | number; label: string }[]) =>
    list.map((o, i) => ({ id: i + 1, ...o }));
  const daysList = (list: number[]) => numbered(list.map((d) => ({ value: d, label: `${d} Days` })));
  res.json({
    reminderDays: daysList(REMINDER_DAY_CHOICES),
    escalationDays: daysList(ESCALATION_DAY_CHOICES),
    reminderValues: numbered(REMINDER_VALUE_CHOICES.map((d) => ({ value: d, label: String(d) }))),
    units: numbered(UNITS.map(({ value, label }) => ({ value, label }))),
    reminderNames: REMINDER_NAMES,
    renewalValidity: numbered(RENEWAL_VALIDITY),
  });
});

documentSettingsRouter.get('/', async (_req, res) => {
  const settings = await globalSettings();
  const badges = await pendingBadges('documentSettings', [SETTINGS_ID]);
  const user = settings.updatedBy
    ? await db.user.findUnique({ where: { id: settings.updatedBy }, select: { name: true } })
    : null;
  res.json(
    toJson({
      ...settings,
      id: SETTINGS_ID,
      updatedByName: user?.name ?? null,
      pendingRequest: badges.get(SETTINGS_ID) ?? null,
    }),
  );
});

documentSettingsRouter.put('/', async (req, res) => {
  const { queued } = await runCustomWrite(
    globalWrite,
    { params: {}, body: req.body, action: 'update' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  res.json(toJson({ ...(await globalSettings()), id: SETTINGS_ID, pendingRequest: null }));
});

// ---- Per type: /document-types/expiry-settings and /document-types/:id/expiry-settings --------------------

export const documentTypeExpiryRouter = Router();

/** The "Document Type-wise Expiry Settings" table: live types, search by type or category, Category filter. */
documentTypeExpiryRouter.get('/expiry-settings', async (req, res) => {
  const q = (k: string) => (typeof req.query[k] === 'string' ? req.query[k].trim() : '');
  const page = Math.max(1, Number.parseInt(q('page'), 10) || 1);
  const perPage = Math.min(100, Math.max(1, Number.parseInt(q('perPage'), 10) || 10));
  const search = q('search');
  const where = {
    deletedAt: null,
    ...(q('category') ? { category: q('category') } : {}),
    ...(q('status') ? { status: q('status') } : {}),
    ...(search
      ? {
          OR: [
            { typeName: { contains: search } },
            { typeCode: { contains: search } },
            { categoryRef: { categoryName: { contains: search } } },
          ],
        }
      : {}),
  };
  const [total, types] = await Promise.all([
    db.documentType.count({ where }),
    db.documentType.findMany({
      where,
      include: { categoryRef: { select: { categoryName: true } } },
      orderBy: [
        { categoryRef: { displayOrder: 'asc' } },
        { displayOrder: 'asc' },
        { typeName: 'asc' },
        { id: 'asc' },
      ],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);
  const badges = await pendingBadges(
    'documentType',
    types.map((t) => t.id),
  );
  res.json(
    toJson({
      data: types.map((t) => typeRow(t, badges.get(t.id) ?? null)),
      meta: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    }),
  );
});

documentTypeExpiryRouter.get('/:id/expiry-settings', async (req, res) => {
  const type = await liveType(req.params.id);
  const badges = await pendingBadges('documentType', [type.id]);
  res.json(toJson(typeRow(type, badges.get(type.id) ?? null)));
});

documentTypeExpiryRouter.put('/:id/expiry-settings', async (req, res) => {
  const { queued } = await runCustomWrite(
    typeWrite,
    { params: { id: req.params.id }, body: req.body, action: 'update' },
    currentUserId(req),
  );
  if (queued) return void res.status(202).json(queued);
  res.json(toJson(typeRow(await liveType(req.params.id), null)));
});

const tags = ['Document expiry settings'];
docsPaths['/document-settings'] = {
  get: {
    tags,
    summary: 'Global Expiry & Renewal settings (image 4)',
    responses: { '200': { description: 'Settings' } },
  },
  put: {
    tags,
    summary: 'Save the global settings (approval module documents: 202 when On)',
    responses: { '200': { description: 'Saved' }, '202': { description: 'Sent for approval' } },
  },
};
docsPaths['/document-settings/filter-options'] = {
  get: {
    tags,
    summary: 'Dropdowns: reminderDays, escalationDays, reminderValues, units, renewalValidity',
    responses: { '200': { description: 'Lists' } },
  },
};
docsPaths['/document-types/expiry-settings'] = {
  get: {
    tags,
    summary: 'Document Type-wise Expiry Settings table (page, perPage, search, category, status)',
    responses: { '200': { description: '{ data, meta }' } },
  },
};
docsPaths['/document-types/{id}/expiry-settings'] = {
  get: {
    tags,
    summary: "One type's expiry settings (image 5)",
    responses: { '200': { description: 'Settings' } },
  },
  put: {
    tags,
    summary: "Save one type's expiry settings (approval module documents: 202 when On)",
    responses: { '200': { description: 'Saved' }, '202': { description: 'Sent for approval' } },
  },
};
