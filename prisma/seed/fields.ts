import { type Database } from '../../src/lib/db.js';
import { seedOne } from './util.js';

/**
 * RP1-14 sample fields: the prototype's `fieldList` for Jamuna Tea Estate, Rangpur Division. Block 01 has
 * the prototype's `details` and its map `polygon`; the others get a small square boundary beside it so
 * the map has something to draw. Types and statuses are the form's values (tea_field, active).
 */
const FIELDS = [
  ['Block 01', 'BLK-01', 'tea_field', 25.5, 23.75, 'active', 'SEC-001'],
  ['Block 02', 'BLK-02', 'tea_field', 18.3, 17.2, 'active', 'SEC-001'],
  ['Block 03', 'BLK-03', 'tea_field', 22.75, 21.1, 'active', 'SEC-002'],
  ['Block 04', 'BLK-04', 'tea_field', 16, 15.3, 'inactive', 'SEC-002'],
  ['Nursery Block', 'NUR-01', 'nursery', 2.5, 2.5, 'active', 'SEC-003'],
  ['Extension Field', 'EXT-01', 'extension', 12.4, 0, 'active', 'SEC-003'],
  ['Road Reserve', 'RD-01', 'infrastructure', 3.2, 0, 'active', 'SEC-004'],
  ['Drain Area', 'DR-01', 'drain', 1.8, 0, 'active', 'SEC-004'],
] as const;

const BLOCK_01_POLYGON = [
  [25.7468, 89.2708],
  [25.7475, 89.272],
  [25.7466, 89.273],
  [25.7457, 89.2724],
  [25.7459, 89.271],
];

/** A square of about 150 m beside Block 01, one per field. */
const square = (index: number) => {
  const lat = 25.7445 - Math.floor(index / 4) * 0.0025;
  const lng = 89.2705 + (index % 4) * 0.0025;
  const d = 0.0014;
  return [
    [lat, lng],
    [lat, lng + d],
    [lat - d, lng + d],
    [lat - d, lng],
  ].map(([a, b]) => [Math.round((a ?? 0) * 1e6) / 1e6, Math.round((b ?? 0) * 1e6) / 1e6]);
};

export async function seedFields(
  db: Database,
  userId: string,
  estates: Record<string, string>,
  divisions: Record<string, string>,
  sections: Record<string, string>,
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  const estate = estates['JTE-001'];
  const division = divisions['JTE-001/DIV-01'];
  if (!estate || !division) return ids;
  for (const [
    index,
    [fieldName, fieldCode, fieldType, totalArea, plantedArea, status, sectionCode],
  ] of FIELDS.entries()) {
    const section = sections[`JTE-001/DIV-01/${sectionCode}`];
    if (!section) continue;
    const tea = fieldType === 'tea_field';
    ids[fieldCode] = await seedOne(
      db,
      userId,
      'fieldBlock',
      { estate, fieldCode },
      {
        estate,
        division,
        section,
        fieldName,
        fieldCode,
        fieldType,
        parentField: null,
        totalArea,
        plantedArea,
        plantingYear: index === 0 ? 2018 : 2015 + index,
        bushType:
          index === 0 ? 'tv-1' : tea ? (['tv-18', 'bt-2', 'clone-6'] as const)[index % 3] : 'seedling',
        spacing: index === 0 ? '4ft × 2.5ft' : '3 × 4',
        altitude: index === 0 ? 240 : 220 + index * 5,
        averageSlope: index === 0 ? 5 : 3 + (index % 4),
        irrigation: 'natural_rain',
        soilType: index % 2 ? 'clay' : 'loamy',
        drainage: index % 3 ? 'average' : 'good',
        status,
        description: null,
        polygon: index === 0 ? BLOCK_01_POLYGON : square(index),
      },
    );
  }
  return ids;
}
