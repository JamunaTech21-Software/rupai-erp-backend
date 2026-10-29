import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { centre, isPolygon, perimeterKm, type Point } from '../../lib/geo.js';
import { z } from '../../lib/validation.js';
import { checkLocation } from './location.js';

/**
 * RP1-15 A.4 Map & GIS Tracking: `MapAndGISTracking.jsx`. No form; one read for the whole page, shaped like
 * `MapAndGISTrackingData.js` so the page can swap its import for this answer:
 *
 *   GET /map?estate=<id>&division=&section=&fieldBlock=&fieldType=&status=&search=&page=&perPage=
 *
 * The filters narrow the fields (table, polygons, field cards) and the section boundaries; estate areas
 * are the estate's own. Layers the estate keeps (boundary, roads, drains, water, buildings, markers) are
 * seeded in `estate_maps`. `focus` (RP1-53) is the narrowest selection (field → section → division → estate):
 * its point, outline and bounds, so the page can centre and zoom the map on it.
 */
const Query = z.object({
  estate: z.string({ error: 'This field is required.' }).trim().length(26, 'Select a value from the list.'),
  division: z.string().trim().min(1).optional().catch(undefined),
  section: z.string().trim().min(1).optional().catch(undefined),
  fieldBlock: z.string().trim().min(1).optional().catch(undefined),
  fieldType: z.string().trim().min(1).optional().catch(undefined),
  status: z.string().trim().min(1).optional().catch(undefined),
  search: z.string().trim().min(1).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  perPage: z.coerce.number().int().min(1).max(100).catch(10),
});

const SECTION_COLOURS = ['#22c55e', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6', '#84cc16'];
const FIELD_COLOUR = '#16a34a';
const acres = (n: unknown) => `${Number(n ?? 0).toFixed(2)} Acre`;
const longDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export const mapRouter = Router();

mapRouter.get('/', async (req, res) => {
  const parsed = Query.safeParse(req.query);
  if (!parsed.success)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', {
      estate: parsed.error.issues[0]?.message ?? 'Select a value from the list.',
    });
  const q = parsed.data;
  const estate = await db.estate.findFirst({ where: { id: q.estate, deletedAt: null } });
  if (!estate) throw notFound('Estate');
  const mismatch = await checkLocation(q);
  if (Object.keys(mismatch).length)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', mismatch);
  const [division, section, field] = await Promise.all([
    q.division ? db.division.findFirst({ where: { id: q.division, deletedAt: null } }) : null,
    q.section ? db.section.findFirst({ where: { id: q.section, deletedAt: null } }) : null,
    q.fieldBlock
      ? db.fieldBlock.findFirst({ where: { id: q.fieldBlock, estate: estate.id, deletedAt: null } })
      : null,
  ]);
  if (q.division && !division)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', {
      division: 'Select a value from the list.',
    });
  if (q.section && !section)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', {
      section: 'Select a value from the list.',
    });
  if (q.fieldBlock && !field)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', {
      fieldBlock: 'Select a value from the list.',
    });

  const fieldWhere = {
    estate: estate.id,
    deletedAt: null,
    ...(q.division ? { division: q.division } : {}),
    ...(q.section ? { section: q.section } : {}),
    ...(q.fieldBlock ? { id: q.fieldBlock } : {}),
    ...(q.fieldType ? { fieldType: q.fieldType } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.search
      ? { OR: [{ fieldName: { contains: q.search } }, { fieldCode: { contains: q.search } }] }
      : {}),
  };
  const [layers, sections, polygons, page, total, active, inactive, lastField] = await Promise.all([
    db.estateMap.findUnique({ where: { estate: estate.id } }),
    db.section.findMany({
      where: {
        deletedAt: null,
        ...(q.section ? { id: q.section } : field ? { id: field.section } : {}),
        divisionRef: {
          is: { estate: estate.id, deletedAt: null, ...(q.division ? { id: q.division } : {}) },
        },
      },
      orderBy: { sectionCode: 'asc' },
    }),
    db.fieldBlock.findMany({
      where: fieldWhere,
      select: { id: true, fieldCode: true, fieldName: true, polygon: true },
      orderBy: { fieldCode: 'asc' },
    }),
    db.fieldBlock.findMany({
      where: fieldWhere,
      orderBy: { fieldCode: 'asc' },
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
      include: {
        divisionRef: { select: { divisionName: true } },
        sectionRef: { select: { sectionName: true } },
      },
    }),
    db.fieldBlock.count({ where: fieldWhere }),
    db.fieldBlock.count({ where: { ...fieldWhere, status: 'active' } }),
    db.fieldBlock.count({ where: { ...fieldWhere, status: 'inactive' } }),
    db.fieldBlock.findFirst({
      where: { estate: estate.id, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true, updatedBy: true },
    }),
  ]);

  // "Last updated" is the newest change to the estate, its map layers or its fields.
  const latest = [
    { at: estate.updatedAt, by: estate.updatedBy },
    ...(layers ? [{ at: layers.updatedAt, by: layers.updatedBy }] : []),
    ...(lastField ? [{ at: lastField.updatedAt, by: lastField.updatedBy }] : []),
  ].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  const updatedBy = latest
    ? await db.user.findUnique({ where: { id: latest.by }, select: { name: true } })
    : null;

  const boundary = isPolygon(layers?.estateBoundary) ? layers.estateBoundary : null;
  const focus = mapFocus({
    estate,
    boundary,
    zoom: layers?.zoom ?? 15,
    division,
    section,
    field,
    sections,
    polygons,
  });
  const [latitude, longitude] = boundary
    ? centre(boundary)
    : [Number(estate.latitude), Number(estate.longitude)];
  const totalArea = Number(estate.totalLandArea);
  const teaArea = Number(estate.teaArea);
  const nonTeaArea = Number(estate.nonTeaArea ?? totalArea - teaArea);
  const statistics = {
    totalEstateArea: totalArea,
    teaArea,
    nonTeaArea,
    totalFieldBlock: total,
    activeFieldBlock: active,
    inactiveFieldBlock: inactive,
  };

  res.json({
    mapInfo: {
      estateId: estate.id,
      estateName: estate.estateName,
      latitude,
      longitude,
      zoom: layers?.zoom ?? 15,
      totalArea: acres(totalArea),
      teaArea: acres(teaArea),
      nonTeaArea: acres(nonTeaArea),
      coordinateSystem: 'WGS84',
      lastUpdated: latest ? longDate(latest.at) : null,
      updatedBy: updatedBy?.name ?? null,
    },
    statistics,
    summaryCards: [
      {
        id: 1,
        title: 'Total Estate Area',
        value: totalArea.toFixed(2),
        unit: 'Acre',
        icon: 'Map',
        color: 'green',
      },
      { id: 2, title: 'Tea Area', value: teaArea.toFixed(2), unit: 'Acre', icon: 'Leaf', color: 'green' },
      {
        id: 3,
        title: 'Non Tea Area',
        value: nonTeaArea.toFixed(2),
        unit: 'Acre',
        icon: 'Trees',
        color: 'green',
      },
      {
        id: 4,
        title: 'Total Field / Block',
        value: String(total),
        unit: '',
        icon: 'SquareDashed',
        color: 'green',
      },
      {
        id: 5,
        title: 'Active Field / Block',
        value: String(active),
        unit: '',
        icon: 'CheckCircle2',
        color: 'green',
      },
      {
        id: 6,
        title: 'Inactive Field / Block',
        value: String(inactive),
        unit: '',
        icon: 'XCircle',
        color: 'red',
      },
    ],
    mapFooter: {
      totalArea: acres(totalArea),
      perimeter: boundary ? `${perimeterKm(boundary).toFixed(2)} Km` : null,
      totalFields: total,
      activeFields: active,
      inactiveFields: inactive,
      // RP1-53: the point of the current selection (the estate when nothing narrower is picked).
      coordinates: { latitude: focus.latitude, longitude: focus.longitude },
    },
    focus,
    estateBoundary: boundary ?? [],
    sectionBoundaries: sections
      .filter((s) => isPolygon(s.polygon))
      .map((s, i) => ({
        id: s.id,
        name: s.sectionName,
        code: s.sectionCode,
        color: SECTION_COLOURS[i % SECTION_COLOURS.length],
        coordinates: s.polygon,
      })),
    fieldPolygons: polygons
      .filter((f) => isPolygon(f.polygon))
      .map((f) => ({
        id: f.id,
        code: f.fieldCode,
        name: f.fieldName,
        color: FIELD_COLOUR,
        coordinates: f.polygon,
      })),
    roads: layers?.roads ?? [],
    drains: layers?.drains ?? [],
    waterBodies: layers?.waterBodies ?? [],
    buildings: layers?.buildings ?? [],
    markers: layers?.markers ?? [],
    fieldList: page.map((f) => {
      const point = pointOf(f);
      return {
        id: f.id,
        fieldName: f.fieldName,
        code: f.fieldCode,
        division: f.divisionRef.divisionName,
        section: f.sectionRef.sectionName,
        fieldType: f.fieldType,
        totalArea: Number(f.totalArea),
        teaArea: Number(f.plantedArea),
        latitude: point?.[0] ?? null,
        longitude: point?.[1] ?? null,
        status: f.status,
      };
    }),
    meta: { page: q.page, perPage: q.perPage, total, totalPages: Math.max(1, Math.ceil(total / q.perPage)) },
  });
});

/** A record's own map point, or the centre of its outline. */
function pointOf(r: { latitude?: unknown; longitude?: unknown; polygon?: unknown }): Point | null {
  if (r.latitude !== null && r.latitude !== undefined && r.longitude !== null && r.longitude !== undefined)
    return [Number(r.latitude), Number(r.longitude)];
  return isPolygon(r.polygon) ? centre(r.polygon) : null;
}

/** South-west and north-east corners around all the points, or null. */
function boundsOf(points: Point[]): [Point, Point] | null {
  if (!points.length) return null;
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

interface Located {
  id: string;
  latitude?: unknown;
  longitude?: unknown;
  polygon?: unknown;
}

/**
 * RP1-53: where the map should look. The narrowest picked level wins; its point is its own (G.1 / G.2) or
 * its outline's centre, falling back to the level above. `bounds` covers its outline, or everything drawn
 * under it, so the page can fit the map to it.
 */
function mapFocus(input: {
  estate: { id: string; estateName: string; latitude: unknown; longitude: unknown };
  boundary: Point[] | null;
  zoom: number;
  division: (Located & { divisionName: string }) | null;
  section: (Located & { sectionName: string }) | null;
  field: (Located & { fieldName: string; fieldCode: string }) | null;
  sections: Located[];
  polygons: Located[];
}) {
  const { estate, boundary, zoom, division, section, field, sections, polygons } = input;
  const estatePoint: Point = boundary
    ? centre(boundary)
    : [Number(estate.latitude), Number(estate.longitude)];
  const drawn = [...sections, ...polygons].flatMap((r) => (isPolygon(r.polygon) ? r.polygon : []));
  const level = field ? 'fieldBlock' : section ? 'section' : division ? 'division' : 'estate';
  const picked = field ?? section ?? division;
  const outline = picked && isPolygon(picked.polygon) ? picked.polygon : level === 'estate' ? boundary : null;
  const point =
    (picked && pointOf(picked)) ??
    (section && pointOf(section)) ??
    (division && pointOf(division)) ??
    (level === 'estate' ? estatePoint : (boundsCentre(boundsOf(drawn)) ?? estatePoint));
  return {
    level,
    id: picked?.id ?? estate.id,
    name: field
      ? `${field.fieldName} (${field.fieldCode})`
      : section
        ? section.sectionName
        : division
          ? division.divisionName
          : estate.estateName,
    latitude: point[0],
    longitude: point[1],
    polygon: outline,
    bounds: boundsOf(outline ?? drawn),
    zoom: { estate: zoom, division: zoom + 1, section: zoom + 2, fieldBlock: zoom + 3 }[level],
  };
}

const boundsCentre = (b: [Point, Point] | null): Point | null =>
  b ? [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2] : null;

docsPaths['/map'] = {
  get: {
    tags: ['Map & GIS'],
    summary: 'Everything the Map & GIS page shows, shaped like MapAndGISTrackingData.js',
    parameters: [
      { name: 'estate', in: 'query', required: true, schema: { type: 'string' }, description: 'Estate id' },
      ...['division', 'section', 'fieldBlock', 'fieldType', 'status', 'search'].map((name) => ({
        name,
        in: 'query',
        required: false,
        schema: { type: 'string' },
      })),
      { name: 'page', in: 'query', required: false, schema: { type: 'integer' } },
      { name: 'perPage', in: 'query', required: false, schema: { type: 'integer' } },
    ],
    responses: {
      '200': {
        description:
          'mapInfo, statistics, summaryCards, mapFooter, focus { level, id, name, latitude, longitude, polygon, bounds, zoom }, estateBoundary, sectionBoundaries, fieldPolygons, roads, drains, waterBodies, buildings, markers, fieldList, meta',
      },
      '400': {
        description:
          'estate missing, or a division / section / field that does not belong to the one above it',
      },
      '404': { description: 'Estate not found' },
    },
  },
};
