import { db } from '../../lib/db.js';
import { code, longText, num, oneOf, optInt, optRef, optText, ref, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-13 A.2 Division & Section: `DivisionAndSection.jsx`, its two forms (Add Division, Add Section) and
 * two tables. Keys are the forms' `register(...)` names; rules and messages are the page's own.
 */
export const STATUSES = ['Active', 'Inactive'] as const;

/** Area in acres, more than 0 ("Area must be greater than 0"). */
const area = () => num().refine((v) => v > 0, 'Area must be greater than 0');

const divisionSchema = z.object({
  estate: ref(),
  divisionName: text(),
  divisionCode: code(/^DIV-\d+$/, 'Example: DIV-01'),
  totalArea: area(),
  totalSection: optInt('Value cannot be negative'),
  status: oneOf(STATUSES),
  description: longText().refine((v) => v === null || v.length <= 250, 'Maximum 250 characters'),
});

const sectionSchema = z.object({
  division: ref(),
  parentSection: optRef(),
  sectionName: text(),
  sectionCode: code(/^SEC-\d+$/, 'Example: SEC-001'),
  totalArea: area(),
  /** The prototype's `managerOptions` name, until employees exist (C.1). */
  manager: optText(),
  status: oneOf(STATUSES),
});

export const divisionsRouter = defineResource('/divisions', {
  name: 'division',
  label: 'Division',
  model: 'division',
  schema: divisionSchema,
  search: ['divisionName', 'divisionCode'],
  filters: ['estate', 'status', 'divisionCode'],
  refs: { estate: { model: 'estate', label: 'estateName' } },
  unique: [{ field: 'divisionCode', scope: ['estate'] }],
  orderBy: { divisionCode: 'asc' },
  /**
   * The Division & Section Summary cards (`divisionSectionData.summary`), for the same filters. Sections are
   * the saved section records; averageSectionArea is their average area.
   */
  summary: async (where) => {
    const sectionWhere = { deletedAt: null, divisionRef: { is: where } };
    const [divisions, activeDivision, sections, activeSection] = await Promise.all([
      db.division.aggregate({ where, _count: { _all: true }, _sum: { totalArea: true } }),
      db.division.count({ where: { ...where, status: 'Active' } }),
      db.section.aggregate({ where: sectionWhere, _count: { _all: true }, _avg: { totalArea: true } }),
      db.section.count({ where: { ...sectionWhere, status: 'Active' } }),
    ]);
    return {
      totalDivision: divisions._count._all,
      totalSection: sections._count._all,
      totalArea: Number(divisions._sum.totalArea ?? 0),
      averageSectionArea: Math.round(Number(sections._avg.totalArea ?? 0) * 100) / 100,
      activeDivision,
      activeSection,
    };
  },
  options: { path: 'divisions', label: (row) => String(row.divisionName), filters: ['estate'] },
});

export const sectionsRouter = defineResource('/sections', {
  name: 'section',
  label: 'Section',
  model: 'section',
  schema: sectionSchema,
  search: ['sectionName', 'sectionCode'],
  filters: [
    'division',
    'status',
    { name: 'estate', where: (estate) => ({ divisionRef: { is: { estate } } }) },
  ],
  refs: {
    division: { model: 'division', label: 'divisionName' },
    parentSection: { model: 'section', label: 'sectionName' },
  },
  unique: [{ field: 'sectionCode', scope: ['division'] }],
  orderBy: { sectionCode: 'asc' },
  /** A parent section is another section of the same division. */
  check: async (values, id): Promise<Record<string, string>> => {
    const parent = values.parentSection;
    if (typeof parent !== 'string') return {};
    if (parent === id) return { parentSection: 'A section cannot be its own parent.' };
    const same = await db.section.count({ where: { id: parent, division: values.division as string } });
    return same ? {} : { parentSection: 'Pick a section of the same division.' };
  },
  options: { path: 'sections', label: (row) => String(row.sectionName), filters: ['division'] },
});
