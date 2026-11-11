import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { int, oneOf, optText, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { documentCounts } from './documents.js';

/**
 * RP1-139 N.1 Document Category: the Documents Management design, images 2 and 3 (`/documents-category`).
 * List columns: SL, Category Code, Category Name, Description, Total Documents, Status, Display Order. The form:
 * Category Code, Category Name, Description, Status, Display Order and the "Examples (This Category)" box,
 * which lists the category's Active document types (RP1-142). Total Documents counts its live documents
 * (RP1-148).
 */
const STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];
const labelOf = (value: unknown) => STATUSES.find((o) => o.value === value)?.label ?? null;

const categorySchema = z.object({
  categoryCode: text(10)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, - or _ only (for example ENV).')
    .transform((v) => v.toUpperCase()),
  categoryName: text(100),
  description: optText(500),
  status: oneOf(STATUSES.map((o) => o.value)),
  displayOrder: int('Must be 1 or more.').refine((v) => v >= 1, 'Must be 1 or more.'),
});

export const documentCategoriesRouter = defineResource('/document-categories', {
  name: 'documentCategory',
  label: 'Document category',
  module: 'documents',
  page: 'Document Category',
  describe: (r) => show(r.categoryCode, paren(r.categoryName)),
  model: 'documentCategory',
  schema: categorySchema,
  search: ['categoryCode', 'categoryName'],
  filters: ['status'],
  unique: ['categoryCode', 'categoryName'],
  orderBy: [{ displayOrder: 'asc' }, { categoryCode: 'asc' }, { id: 'asc' }],
  extend: (row) => ({ statusLabel: labelOf(row.status) }),
  // RP1-142 / RP1-148: a category stays while document types or documents use it.
  deleteCheck: async (row) => {
    const used = await db.documentType.count({ where: { category: row.id, deletedAt: null } });
    if (used) return `This category has ${used} document type${used === 1 ? '' : 's'}.`;
    const docs = await db.document.count({ where: { category: row.id, deletedAt: null } });
    return docs ? `This category has ${docs} document${docs === 1 ? '' : 's'}.` : undefined;
  },
  /** The Examples box: the category's Active types in order (RP1-142), and Total Documents (RP1-148). */
  enrich: async (rows) => {
    const counts = await documentCounts(
      'category',
      rows.map((r) => r.id),
    );
    const types = await db.documentType.findMany({
      where: { category: { in: rows.map((r) => r.id) }, deletedAt: null, status: 'ACTIVE' },
      orderBy: [{ displayOrder: 'asc' }, { typeName: 'asc' }],
      select: { category: true, typeName: true },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        {
          totalDocuments: counts.get(r.id) ?? 0,
          examples: types.filter((t) => t.category === r.id).map((t) => t.typeName),
        },
      ]),
    );
  },
  summary: async (where) => {
    const [groups, ids] = await Promise.all([
      db.documentCategory.groupBy({ by: ['status'], where, _count: { _all: true } }),
      db.documentCategory.findMany({ where, select: { id: true } }),
    ]);
    const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
    return {
      totalCategories: groups.reduce((sum, g) => sum + g._count._all, 0),
      active: count('ACTIVE'),
      inactive: count('INACTIVE'),
      totalDocuments: await db.document.count({
        where: { deletedAt: null, archivedAt: null, category: { in: ids.map((c) => c.id) } },
      }),
    };
  },
  export: {
    fileName: 'document-categories',
    sheet: 'Document Categories',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Category Code', value: (row) => row.categoryCode, width: 14 },
      { header: 'Category Name', value: (row) => row.categoryName, width: 30 },
      { header: 'Description', value: (row) => row.description, width: 60 },
      { header: 'Total Documents', value: (row) => row.totalDocuments, width: 16 },
      { header: 'Status', value: (row) => row.statusLabel, width: 10 },
      { header: 'Display Order', value: (row) => row.displayOrder, width: 14 },
    ],
  },
  options: { path: 'document-categories', label: (row) => String(row.categoryName), filters: ['status'] },
});

/** The page's Status filter and the form's Status dropdown. */
export const documentCategoryExtrasRouter = Router();
documentCategoryExtrasRouter.get('/filter-options', (_req, res) => {
  res.json({ statuses: STATUSES.map((o, i) => ({ id: i + 1, ...o })) });
});
docsPaths['/document-categories/filter-options'] = {
  get: {
    tags: ['Document category'],
    summary: 'Document Category filter and form options: statuses',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
