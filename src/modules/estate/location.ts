import { db } from '../../lib/db.js';

/**
 * Estate → division → section → field / block picked on one form must belong together (A.3 and every
 * Plantation page). Checks only the keys the form has; returns messages by field.
 */
export async function checkLocation(values: Record<string, unknown>): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};
  const id = (key: string) => (typeof values[key] === 'string' ? values[key] : undefined);
  const [division, section, field] = await Promise.all([
    id('division')
      ? db.division.findFirst({ where: { id: id('division') }, select: { estate: true } })
      : null,
    id('section') ? db.section.findFirst({ where: { id: id('section') }, select: { division: true } }) : null,
    id('fieldBlock')
      ? db.fieldBlock.findFirst({ where: { id: id('fieldBlock') }, select: { section: true } })
      : null,
  ]);
  if (division && id('estate') && division.estate !== id('estate'))
    fields.division = 'Pick a division of the selected estate.';
  if (section && id('division') && section.division !== id('division'))
    fields.section = 'Pick a section of the selected division.';
  if (field && id('section') && field.section !== id('section'))
    fields.fieldBlock = 'Pick a field of the selected section.';
  return fields;
}

/** An optional map point (RP1-51): latitude and longitude are given together or not at all. */
export function checkPoint(values: Record<string, unknown>): Record<string, string> {
  const lat = values.latitude ?? null;
  const lng = values.longitude ?? null;
  if (lat !== null && lng === null) return { longitude: 'Enter the longitude too.' };
  if (lat === null && lng !== null) return { latitude: 'Enter the latitude too.' };
  return {};
}
