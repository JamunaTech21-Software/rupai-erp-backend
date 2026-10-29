import { db } from '../../lib/db.js';
import {
  longText,
  num,
  oneOf,
  optCoord,
  optNum,
  optOneOf,
  optRef,
  polygon,
  ref,
  text,
} from '../../lib/fields.js';
import { centre, isPolygon, perimeterKm } from '../../lib/geo.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { checkPoint } from './location.js';

/**
 * RP1-14 A.3 Field/Block Management: `FieldOrBlockManagement.jsx`. Keys are the form's `register(...)`
 * names; options are the `value`s in `FieldAndBlockManagementData.js`; messages are the page's own.
 */
export const FIELD_TYPES = [
  'tea_field',
  'nursery',
  'shade_area',
  'road_side',
  'water_body',
  'extension',
  'infrastructure',
  'drain',
  'road_reserve',
] as const;
export const FIELD_STATUSES = ['active', 'inactive', 'under_development', 'maintenance'] as const;
export const BUSH_TYPES = ['tv-1', 'tv-18', 'bt-2', 'clone-6', 'seedling'] as const;
export const IRRIGATION_SOURCES = ['natural_rain', 'tube_well', 'river', 'canal'] as const;
export const SOIL_TYPES = ['loamy', 'clay', 'sandy', 'mixed'] as const;
export const DRAINAGE = ['good', 'average', 'poor'] as const;

const fieldSchema = z.object({
  estate: ref(),
  division: ref(),
  section: ref(),
  fieldName: text(),
  fieldCode: text(60),
  fieldType: oneOf(FIELD_TYPES),
  parentField: optRef(),
  totalArea: num().refine((v) => v > 0, 'Area must be greater than 0'),
  // The page asks for more than 0, but its own list has roads and drains with 0 planted, so 0 is allowed.
  plantedArea: num(),
  plantingYear: num()
    .refine((v) => Number.isInteger(v), 'Must be a whole number.')
    .refine((v) => v >= 1900, 'Invalid year')
    .refine((v) => v <= new Date().getFullYear(), 'Year cannot be in the future'),
  bushType: oneOf(BUSH_TYPES),
  spacing: text(60),
  altitude: optNum('Altitude cannot be negative'),
  averageSlope: optNum('Slope cannot be negative').refine(
    (v) => v === null || v <= 100,
    'Slope cannot exceed 100%',
  ),
  irrigation: optOneOf(IRRIGATION_SOURCES),
  soilType: optOneOf(SOIL_TYPES),
  drainage: optOneOf(DRAINAGE),
  status: oneOf(FIELD_STATUSES),
  description: longText(),
  /** Boundary for the map view: [[latitude, longitude], …]. */
  polygon: polygon(),
  /** RP1-52: the field's point on the map (optional; together). */
  latitude: optCoord(90),
  longitude: optCoord(180),
});

/** Picks must belong together: division of the estate, section of the division, parent in the section. */
async function check(values: Record<string, unknown>, id?: string): Promise<Record<string, string>> {
  const fields = checkPoint(values);
  const [division, section] = await Promise.all([
    db.division.findFirst({ where: { id: values.division as string }, select: { estate: true } }),
    db.section.findFirst({ where: { id: values.section as string }, select: { division: true } }),
  ]);
  if (division?.estate !== values.estate) fields.division = 'Pick a division of the selected estate.';
  if (section?.division !== values.division) fields.section = 'Pick a section of the selected division.';
  if (Number(values.plantedArea) > Number(values.totalArea))
    fields.plantedArea = 'Planted area cannot be more than the total area.';
  const parent = values.parentField;
  if (typeof parent === 'string') {
    if (parent === id) fields.parentField = 'A field cannot be its own parent.';
    else if (!(await db.fieldBlock.count({ where: { id: parent, section: values.section as string } })))
      fields.parentField = 'Pick a field of the same section.';
  }
  return fields;
}

const COUNTED_TYPES = {
  teaField: 'tea_field',
  nursery: 'nursery',
  extension: 'extension',
  infrastructure: 'infrastructure',
  drainArea: 'drain',
} as const;

export const fieldsRouter = defineResource('/fields', {
  name: 'field',
  label: 'Field / Block',
  model: 'fieldBlock',
  schema: fieldSchema,
  search: ['fieldName', 'fieldCode'],
  filters: ['estate', 'division', 'section', 'fieldType', 'status', 'parentField'],
  refs: {
    estate: { model: 'estate', label: 'estateName' },
    division: { model: 'division', label: 'divisionName' },
    section: { model: 'section', label: 'sectionName' },
    parentField: { model: 'fieldBlock', label: 'fieldName' },
  },
  unique: [{ field: 'fieldCode', scope: ['estate'] }],
  check,
  orderBy: { fieldCode: 'asc' },
  /**
   * The map panel (`fieldAndBlockManagementData.map`): the saved point (RP1-52), or the boundary's centre;
   * perimeter from the boundary. Null when the field has neither.
   */
  extend: (row) => {
    const boundary = isPolygon(row.polygon) ? row.polygon : null;
    const point =
      row.latitude !== null && row.longitude !== null
        ? [Number(row.latitude), Number(row.longitude)]
        : boundary
          ? centre(boundary)
          : null;
    if (!point) return { map: null };
    return {
      map: {
        latitude: point[0],
        longitude: point[1],
        perimeter: boundary ? perimeterKm(boundary) : null,
        totalArea: row.totalArea,
        polygon: boundary,
      },
    };
  },
  /** The Field / Block Summary cards (`fieldAndBlockManagementData.summary`), for the same filters. */
  summary: async (where) => {
    const [totals, active, inactive, ...types] = await Promise.all([
      db.fieldBlock.aggregate({
        where,
        _count: { _all: true },
        _sum: { totalArea: true, plantedArea: true },
      }),
      db.fieldBlock.count({ where: { ...where, status: 'active' } }),
      db.fieldBlock.count({ where: { ...where, status: 'inactive' } }),
      ...Object.values(COUNTED_TYPES).map((fieldType) =>
        db.fieldBlock.count({ where: { ...where, fieldType } }),
      ),
    ]);
    return {
      totalField: totals._count._all,
      ...Object.fromEntries(Object.keys(COUNTED_TYPES).map((key, i) => [key, types[i] ?? 0])),
      totalArea: Number(totals._sum.totalArea ?? 0),
      plantedArea: Number(totals._sum.plantedArea ?? 0),
      activeField: active,
      inactiveField: inactive,
    };
  },
  options: {
    path: 'fields',
    label: (row) => `${String(row.fieldName)} (${String(row.fieldCode)})`,
    filters: ['estate', 'division', 'section', 'fieldType'],
  },
});
