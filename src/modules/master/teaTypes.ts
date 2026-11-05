import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { oneOf, optText, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-96 K.2 Tea Type: `TeaType.jsx`, built from `teaTypeData.js`, so the keys are its field `name`s, the values
 * its option `value`s and the lengths its `maxLength`s. The page has no search, filters, cards or export.
 */
const PROCESSING_METHODS = [
  { value: 'CTC', label: 'CTC (Crush, Tear, Curl)' },
  { value: 'ORTHODOX', label: 'Orthodox' },
  { value: 'GREEN', label: 'Green Tea Processing' },
  { value: 'WHITE', label: 'White Tea Processing' },
  { value: 'OOLONG', label: 'Oolong Processing' },
  { value: 'OTHER', label: 'Other Processing' },
];
const APPLICABLE_FOR = [
  { value: 'PRODUCTION', label: 'Production' },
  { value: 'AUCTION_SALE', label: 'Auction / Sale' },
];
const STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];
const valuesOf = (list: { value: string }[]) => list.map((o) => o.value);
const labelOf = (list: { value: string; label: string }[], value: unknown) =>
  list.find((o) => o.value === value)?.label ?? null;

const pickOne = 'Select at least one.';
const teaTypeSchema = z.object({
  teaTypeCode: text(50),
  teaTypeName: text(100),
  shortName: optText(50),
  processingMethod: oneOf(valuesOf(PROCESSING_METHODS)),
  description: optText(250),
  applicableFor: z
    .array(oneOf(valuesOf(APPLICABLE_FOR)), { error: pickOne })
    .min(1, pickOne)
    .transform((v) => [...new Set(v)]),
  status: oneOf(valuesOf(STATUSES)),
  remarks: optText(250),
});

export const teaTypesRouter = defineResource('/tea-types', {
  name: 'teaType',
  label: 'Tea type',
  module: 'master',
  page: 'Tea Type',
  describe: (r) => show(r.teaTypeCode, paren(r.teaTypeName)),
  model: 'teaType',
  schema: teaTypeSchema,
  search: ['teaTypeCode', 'teaTypeName', 'shortName'],
  filters: ['status'],
  unique: ['teaTypeCode'],
  // The prototype's order: oldest first, new tea types at the end.
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  // RP1-99: a tea type stays while a tea grade uses it.
  deleteCheck: async (row) => {
    const used = await db.teaGrade.count({ where: { teaType: row.id, deletedAt: null } });
    return used ? `This tea type is used by ${used} tea grade${used === 1 ? '' : 's'}.` : undefined;
  },
  extend: (row) => ({
    processingMethodLabel: labelOf(PROCESSING_METHODS, row.processingMethod),
    statusLabel: labelOf(STATUSES, row.status),
  }),
  options: { path: 'tea-types', label: (row) => String(row.teaTypeName), filters: ['status'] },
});

/** The form's dropdowns and checkboxes. */
export const teaTypeExtrasRouter = Router();
teaTypeExtrasRouter.get('/filter-options', (_req, res) => {
  const numbered = (list: { value: string; label: string }[]) => list.map((o, i) => ({ id: i + 1, ...o }));
  res.json({
    processingMethods: numbered(PROCESSING_METHODS),
    applicableFor: numbered(APPLICABLE_FOR),
    statuses: numbered(STATUSES),
  });
});
docsPaths['/tea-types/filter-options'] = {
  get: {
    tags: ['Tea type'],
    summary: 'Tea Type form options: processingMethods, applicableFor, statuses',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
