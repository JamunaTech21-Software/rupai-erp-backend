import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import { oneOf, optText, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-99 K.3 Tea Grade: `TeaGrade.jsx`, built from `teaGradeData.js`, so the keys are its field `name`s and the
 * status values its option `value`s.
 *
 * RP1-208 P.6 (decision 2026-11-19): no Grade Code, Grade Size or Description; the Grade Name is unique; Tea Type
 * and Category are fixed lists (the Tea Type setup page is gone). RP1-211 P.7: no Standard / Specification, so
 * no Standard / Custom counts either.
 */
export const TEA_TYPES = ['CTC', 'Green Tea', 'Orthodox'];
const CATEGORIES = ['Leaf', 'Dust', 'Green-Ortho'];
const STATUSES = ['Active', 'Inactive'];

const gradeSchema = z.object({
  gradeName: text(120),
  teaType: oneOf(TEA_TYPES),
  category: oneOf(CATEGORIES),
  status: oneOf(STATUSES),
  remarks: optText(300),
});

export const teaGradesRouter = defineResource('/tea-grades', {
  name: 'teaGrade',
  label: 'Tea grade',
  module: 'master',
  page: 'Tea Grade',
  describe: (r) => String(r.gradeName),
  model: 'teaGrade',
  schema: gradeSchema,
  search: ['gradeName', 'teaType', 'category'],
  filters: ['teaType', 'category', 'status'],
  unique: ['gradeName'],
  // The prototype's order: oldest first, new grades at the end.
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  /** The cards, the Grade Information panel and the Tea Type Distribution chart. */
  summary: async (where) => {
    const rows = await db.teaGrade.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        status: true,
        updatedAt: true,
        updatedBy: true,
        teaType: true,
      },
    });
    const counts = new Map<string, number>();
    for (const { teaType } of rows) counts.set(teaType, (counts.get(teaType) ?? 0) + 1);
    const latest = rows[0];
    const user = latest
      ? await db.user.findUnique({ where: { id: latest.updatedBy }, select: { name: true } })
      : null;
    return {
      totalGrades: rows.length,
      activeGrades: rows.filter((r) => r.status === 'Active').length,
      inactiveGrades: rows.filter((r) => r.status === 'Inactive').length,
      lastUpdated: latest?.updatedAt ?? null,
      lastUpdatedBy: user?.name ?? null,
      teaTypeDistribution: [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, value]) => ({ name, value })),
    };
  },
  options: { path: 'tea-grades', label: (row) => String(row.gradeName), filters: ['teaType', 'status'] },
});

/** The form's dropdowns and the list's filters (all fixed lists). */
export const teaGradeExtrasRouter = Router();
teaGradeExtrasRouter.get('/filter-options', (_req, res) => {
  const numbered = (list: string[]) => list.map((value, i) => ({ id: i + 1, value, label: value }));
  res.json({ teaTypes: numbered(TEA_TYPES), categories: numbered(CATEGORIES), statuses: numbered(STATUSES) });
});
docsPaths['/tea-grades/filter-options'] = {
  get: {
    tags: ['Tea grade'],
    summary: 'Tea Grade form and filter options: teaTypes, categories, statuses',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
