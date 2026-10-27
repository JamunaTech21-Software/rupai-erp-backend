/** Map helpers for boundaries kept as [latitude, longitude] points (fields.polygon). */
export type Point = [number, number];

const EARTH_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km. */
export function distanceKm([lat1, lng1]: Point, [lat2, lng2]: Point): number {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(a));
}

export const isPolygon = (value: unknown): value is Point[] =>
  Array.isArray(value) &&
  value.length >= 3 &&
  value.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number'));

/** Perimeter of the closed boundary in km, 2 decimals. */
export const perimeterKm = (points: Point[]): number =>
  Math.round(
    points.reduce((sum, p, i) => sum + distanceKm(p, points[(i + 1) % points.length] as Point), 0) * 100,
  ) / 100;

/** The middle of the boundary (average of its points), for the map centre and marker. */
export function centre(points: Point[]): Point {
  const lat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lng = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6];
}
