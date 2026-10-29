import { type Database } from '../../src/lib/db.js';
import { centre, isPolygon, type Point } from '../../src/lib/geo.js';

/**
 * RP1-51 / RP1-52 map points and managers for the seeded divisions, sections and fields. Fills only empty values, so it is
 * safe on a database that already has data and never overwrites what was entered in the dashboard:
 * a section's point is the centre of its boundary; a division's is the middle of its sections' points, or
 * a point around the middle of its estate's mapped sections (or the estate's point); division managers are the seeded estate / operations employees, in turn.
 */
const round7 = (n: number) => Math.round(n * 1e7) / 1e7;
const middle = (points: Point[]): Point => centre(points).map(round7) as Point;

export async function seedLocations(db: Database): Promise<number> {
  let filled = 0;
  const sections = await db.section.findMany({ where: { deletedAt: null } });
  for (const s of sections)
    if (s.latitude === null && isPolygon(s.polygon)) {
      const [latitude, longitude] = middle(s.polygon);
      await db.section.update({ where: { id: s.id }, data: { latitude, longitude } });
      filled += 1;
    }

  // RP1-52: a field's point is the centre of its boundary.
  const fields = await db.fieldBlock.findMany({ where: { deletedAt: null, latitude: null } });
  for (const f of fields)
    if (isPolygon(f.polygon)) {
      const [latitude, longitude] = middle(f.polygon);
      await db.fieldBlock.update({ where: { id: f.id }, data: { latitude, longitude } });
      filled += 1;
    }

  const managers = await db.employee.findMany({
    where: { deletedAt: null, department: { in: ['estate', 'operations'] } },
    orderBy: { employeeId: 'asc' },
    select: { id: true },
  });
  const divisions = await db.division.findMany({
    where: { deletedAt: null },
    orderBy: [{ estate: 'asc' }, { divisionCode: 'asc' }],
    include: { estateRef: { select: { latitude: true, longitude: true } }, sections: true },
  });
  // Where each estate's mapped sections are, so divisions without sections sit near them.
  const anchors = new Map<string, Point>();
  for (const estate of new Set(divisions.map((d) => d.estate))) {
    const points = divisions
      .filter((d) => d.estate === estate)
      .flatMap((d) => d.sections)
      .filter((s) => s.deletedAt === null && s.latitude !== null && s.longitude !== null)
      .map((s): Point => [Number(s.latitude), Number(s.longitude)]);
    if (points.length) anchors.set(estate, middle(points));
  }
  for (const [i, d] of divisions.entries()) {
    const data: { latitude?: number; longitude?: number; manager?: string } = {};
    if (d.latitude === null) {
      const points = d.sections
        .filter((s) => s.deletedAt === null && s.latitude !== null && s.longitude !== null)
        .map((s): Point => [Number(s.latitude), Number(s.longitude)]);
      const [lat, lng] = anchors.get(d.estate) ?? [
        Number(d.estateRef.latitude),
        Number(d.estateRef.longitude),
      ];
      // Divisions without mapped sections sit a little apart around that point.
      const [latitude, longitude] = points.length
        ? middle(points)
        : [round7(lat + 0.004 * Math.cos(i)), round7(lng + 0.004 * Math.sin(i))];
      Object.assign(data, { latitude, longitude });
    }
    const manager = managers[i % Math.max(1, managers.length)];
    if (d.manager === null && manager) data.manager = manager.id;
    if (Object.keys(data).length) {
      await db.division.update({ where: { id: d.id }, data });
      filled += 1;
    }
  }
  return filled;
}
