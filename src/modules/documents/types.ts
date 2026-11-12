import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { bool, int, oneOf, optText, ref, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { documentCounts } from './documents.js';
import { newTypeExpiry } from './expiry.js';

/**
 * RP1-142 N.2 Document Type (`/documents-type`). No image: the Document Category page's style. Form:
 * Document Category, Type Code, Type Name, Description, Status, Display Order, Renewal Required. A new type
 * starts from the default Expiry & Renewal values; its own expiry settings are edited from N.3.
 * RP1-148: Total Documents counts its live documents; a type with documents keeps its category and stays.
 */
const STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];
const labelOf = (value: unknown) => STATUSES.find((o) => o.value === value)?.label ?? null;

const typeSchema = z.object({
  category: ref(),
  typeCode: text(20)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, - or _ only (for example TL).')
    .transform((v) => v.toUpperCase()),
  typeName: text(150),
  description: optText(500),
  status: oneOf(STATUSES.map((o) => o.value)),
  displayOrder: int('Must be 1 or more.').refine((v) => v >= 1, 'Must be 1 or more.'),
  renewalRequired: bool().transform((v) => v !== false),
});

export const documentTypesRouter = defineResource('/document-types', {
  name: 'documentType',
  label: 'Document type',
  module: 'documents',
  page: 'Document Type',
  describe: (r) => show(r.typeCode, paren(r.typeName)),
  model: 'documentType',
  schema: typeSchema,
  search: ['typeCode', 'typeName'],
  searchAlso: (term) => [{ categoryRef: { categoryName: { contains: term } } }],
  filters: ['category', 'status'],
  refs: { category: { model: 'documentCategory', label: 'categoryName' } },
  unique: ['typeCode', { field: 'typeName', scope: ['category'] }],
  orderBy: [
    { categoryRef: { displayOrder: 'asc' } },
    { displayOrder: 'asc' },
    { typeName: 'asc' },
    { id: 'asc' },
  ],
  /** A new type, or one moved to another category, needs an Active category; a type with documents stays. */
  check: async (values, id) => {
    const fields: Record<string, string> = {};
    const before = id
      ? await db.documentType.findUnique({ where: { id }, select: { category: true } })
      : null;
    if (id && before && before.category !== values.category) {
      const docs = await db.document.count({ where: { type: id, deletedAt: null } });
      if (docs) fields.category = 'This type has documents, so its category cannot change.';
    }
    if (!fields.category && (!before || before.category !== values.category)) {
      const category = await db.documentCategory.findFirst({
        where: { id: String(values.category), deletedAt: null },
        select: { status: true },
      });
      if (category && category.status !== 'ACTIVE') fields.category = 'This category is Inactive.';
    }
    return fields;
  },
  onCreate: () => newTypeExpiry(),
  extend: (row) => ({ statusLabel: labelOf(row.status) }),
  // RP1-148: a type stays while documents use it.
  deleteCheck: async (row) => {
    const docs = await db.document.count({ where: { type: row.id, deletedAt: null } });
    return docs ? `This type has ${docs} document${docs === 1 ? '' : 's'}.` : undefined;
  },
  enrich: async (rows) => {
    const counts = await documentCounts(
      'type',
      rows.map((r) => r.id),
    );
    return new Map(rows.map((r) => [r.id, { totalDocuments: counts.get(r.id) ?? 0 }]));
  },
  summary: async (where) => {
    const [groups, renewal, ids] = await Promise.all([
      db.documentType.groupBy({ by: ['status'], where, _count: { _all: true } }),
      db.documentType.count({ where: { ...where, renewalRequired: true } }),
      db.documentType.findMany({ where, select: { id: true } }),
    ]);
    const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
    return {
      totalTypes: groups.reduce((sum, g) => sum + g._count._all, 0),
      active: count('ACTIVE'),
      inactive: count('INACTIVE'),
      renewalRequired: renewal,
      totalDocuments: await db.document.count({
        where: { deletedAt: null, type: { in: ids.map((t) => t.id) } },
      }),
    };
  },
  export: {
    fileName: 'document-types',
    sheet: 'Document Types',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Type Code', value: (row) => row.typeCode, width: 12 },
      { header: 'Type Name', value: (row) => row.typeName, width: 36 },
      { header: 'Category', value: (row) => row.categoryName, width: 30 },
      { header: 'Description', value: (row) => row.description, width: 50 },
      { header: 'Renewal Required', value: (row) => (row.renewalRequired ? 'Yes' : 'No'), width: 16 },
      { header: 'Total Documents', value: (row) => row.totalDocuments, width: 16 },
      { header: 'Status', value: (row) => row.statusLabel, width: 10 },
      { header: 'Display Order', value: (row) => row.displayOrder, width: 14 },
    ],
  },
  options: { path: 'document-types', label: (row) => String(row.typeName), filters: ['category', 'status'] },
});

/** The page's Status filter and the form's Status dropdown; categories come from `/options/document-categories`. */
export const documentTypeExtrasRouter = Router();
documentTypeExtrasRouter.get('/filter-options', (_req, res) => {
  res.json({ statuses: STATUSES.map((o, i) => ({ id: i + 1, ...o })) });
});
docsPaths['/document-types/filter-options'] = {
  get: {
    tags: ['Document type'],
    summary: 'Document Type filter and form options: statuses',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
