import { type Database } from '../../src/lib/db.js';
import { newId } from '../../src/lib/ids.js';

/**
 * RP1-15 sample map layers: the prototype's `MapAndGISTrackingData.js` for Jamuna Tea Estate (estate
 * boundary, roads, drains, water bodies, buildings, markers) and the boundaries of Sections A and B.
 * Added once; left alone on a re-seed.
 */
const LAYERS = {
  estateBoundary: [
    [25.7482, 89.2681],
    [25.7498, 89.2724],
    [25.7479, 89.2763],
    [25.7442, 89.2765],
    [25.7423, 89.2729],
    [25.7434, 89.2686],
  ],
  roads: [
    {
      id: 1,
      name: 'Main Road',
      coordinates: [
        [25.7421, 89.2682],
        [25.7443, 89.2706],
        [25.7466, 89.2728],
        [25.7486, 89.2751],
      ],
    },
    {
      id: 2,
      name: 'Internal Road',
      coordinates: [
        [25.7445, 89.2698],
        [25.7458, 89.2713],
        [25.7468, 89.2726],
      ],
    },
  ],
  drains: [
    {
      id: 1,
      name: 'Drain 01',
      coordinates: [
        [25.7435, 89.2689],
        [25.7446, 89.2703],
        [25.746, 89.2724],
      ],
    },
  ],
  waterBodies: [
    {
      id: 1,
      name: 'Lake',
      coordinates: [
        [25.7448, 89.2738],
        [25.7456, 89.2747],
        [25.7449, 89.2753],
        [25.7441, 89.2745],
      ],
    },
  ],
  buildings: [
    { id: 1, name: 'Factory', latitude: 25.7458, longitude: 89.2728 },
    { id: 2, name: 'Estate Office', latitude: 25.7467, longitude: 89.2712 },
    { id: 3, name: 'Hospital', latitude: 25.7475, longitude: 89.2699 },
  ],
  markers: [
    {
      id: 1,
      name: 'Estate Office',
      type: 'Building',
      latitude: 25.7467,
      longitude: 89.2712,
      icon: 'Building2',
    },
    { id: 2, name: 'Factory', type: 'Factory', latitude: 25.7458, longitude: 89.2728, icon: 'Factory' },
    { id: 3, name: 'Worker Camp', type: 'Camp', latitude: 25.7446, longitude: 89.2706, icon: 'House' },
    { id: 4, name: 'Hospital', type: 'Hospital', latitude: 25.7475, longitude: 89.2699, icon: 'Hospital' },
    { id: 5, name: 'Warehouse', type: 'Warehouse', latitude: 25.7483, longitude: 89.2731, icon: 'Warehouse' },
  ],
  zoom: 15,
};

const SECTION_BOUNDARIES: Record<string, number[][]> = {
  'SEC-001': [
    [25.748, 89.2692],
    [25.7488, 89.2714],
    [25.7472, 89.272],
    [25.7464, 89.2696],
  ],
  'SEC-002': [
    [25.7463, 89.2721],
    [25.7475, 89.2742],
    [25.7458, 89.2754],
    [25.7448, 89.2731],
  ],
};

export async function seedMap(
  db: Database,
  userId: string,
  estates: Record<string, string>,
  sections: Record<string, string>,
): Promise<number> {
  const estate = estates['JTE-001'];
  if (!estate) return 0;
  if (!(await db.estateMap.findUnique({ where: { estate } })))
    await db.estateMap.create({ data: { id: newId(), estate, ...LAYERS, updatedBy: userId } });
  for (const [code, polygon] of Object.entries(SECTION_BOUNDARIES)) {
    const id = sections[`JTE-001/DIV-01/${code}`];
    if (!id) continue;
    const section = await db.section.findUnique({ where: { id }, select: { polygon: true } });
    if (section && section.polygon === null) await db.section.update({ where: { id }, data: { polygon } });
  }
  return 1;
}
