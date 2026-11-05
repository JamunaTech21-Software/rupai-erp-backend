import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { oneOf, optText, ref, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-99 K.3 Tea Grade: `TeaGrade.jsx`, built from `teaGradeData.js`, so the keys are its field `name`s and the
 * category and status values its option `value`s. Tea Type picks a saved Tea Type instead of the prototype's
 * fixed list. The form has no classification, so a grade with a Standard / Specification is Standard (the
 * card's "With Standard") and one without is Custom.
 */
const CATEGORIES = ['Orthodox', 'CTC', 'Specialty'];
const STATUSES = ['Active', 'Inactive'];

const gradeSchema = z.object({
  gradeCode: text(40),
  gradeName: text(120),
  teaType: ref(),
  category: oneOf(CATEGORIES),
  standard: optText(120),
  gradeSize: optText(60),
  status: oneOf(STATUSES),
  description: optText(500),
  remarks: optText(300),
});

export const teaGradesRouter = defineResource('/tea-grades', {
  name: 'teaGrade',
  label: 'Tea grade',
  module: 'master',
  page: 'Tea Grade',
  describe: (r) => show(r.gradeCode, paren(r.gradeName)),
  model: 'teaGrade',
  schema: gradeSchema,
  search: ['gradeCode', 'gradeName', 'category'],
  searchAlso: (term) => [{ teaTypeRef: { teaTypeName: { contains: term } } }],
  filters: ['teaType', 'category', 'status'],
  refs: { teaType: { model: 'teaType', label: 'teaTypeName' } },
  unique: ['gradeCode'],
  // The prototype's order: oldest first, new grades at the end.
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  extend: (row) => ({ gradeClassification: row.standard ? 'Standard' : 'Custom' }),
  /** The cards, the Grade Information panel and the Tea Type Distribution chart. */
  summary: async (where) => {
    const rows = await db.teaGrade.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        status: true,
        standard: true,
        updatedAt: true,
        updatedBy: true,
        teaTypeRef: { select: { teaTypeName: true } },
      },
    });
    const standard = rows.filter((r) => r.standard).length;
    const counts = new Map<string, number>();
    for (const { teaTypeRef } of rows)
      counts.set(teaTypeRef.teaTypeName, (counts.get(teaTypeRef.teaTypeName) ?? 0) + 1);
    const latest = rows[0];
    const user = latest
      ? await db.user.findUnique({ where: { id: latest.updatedBy }, select: { name: true } })
      : null;
    return {
      totalGrades: rows.length,
      activeGrades: rows.filter((r) => r.status === 'Active').length,
      inactiveGrades: rows.filter((r) => r.status === 'Inactive').length,
      standardGrades: standard,
      customGrades: rows.length - standard,
      lastUpdated: latest?.updatedAt ?? null,
      lastUpdatedBy: user?.name ?? null,
      teaTypeDistribution: [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, value]) => ({ name, value })),
    };
  },
  options: { path: 'tea-grades', label: (row) => String(row.gradeName), filters: ['teaType', 'status'] },
});

/** The form's dropdowns and the list's filters; Tea Type comes from `/options/tea-types`. */
export const teaGradeExtrasRouter = Router();
teaGradeExtrasRouter.get('/filter-options', (_req, res) => {
  const numbered = (list: string[]) => list.map((value, i) => ({ id: i + 1, value, label: value }));
  res.json({ categories: numbered(CATEGORIES), statuses: numbered(STATUSES) });
});
docsPaths['/tea-grades/filter-options'] = {
  get: {
    tags: ['Tea grade'],
    summary: 'Tea Grade form and filter options: categories, statuses',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
