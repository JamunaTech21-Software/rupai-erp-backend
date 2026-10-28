import { type Database } from '../../src/lib/db.js';
import { newId } from '../../src/lib/ids.js';
import { seedOne } from './util.js';

/**
 * RP1-17 sample nurseries: the prototype's `nurseryInformation` (Central Nursery, Jamuna / Rangpur
 * Division) with its `nurseryBeds` and `stockInventory`, plus a small one in Tetulia. Beds and stock are
 * added only when the nursery has none.
 */
const BEDS = [
  ['North Bed A', 'NB-001', 'TV-23', 0.5, 2500, '2026-01-12', 'Active'],
  ['South Bed B', 'NB-002', 'TV-25', 0.4, 2200, '2026-01-18', 'Inactive'],
  ['East Bed C', 'NB-003', 'BT-6', 0.35, 1800, '2026-01-22', 'Maintenance'],
  ['West Bed D', 'NB-004', 'TV-26', 0.45, 2800, '2026-01-25', 'Active'],
  ['Central Bed E', 'NB-005', 'S-15', 0.6, 3200, '2026-01-30', 'Inactive'],
  ['Hardening Bed F', 'NB-006', 'TV-30', 0.55, 2950, '2026-02-05', 'Maintenance'],
] as const;

// clone, type, total, available, reserved, distributed, distributed this month
const STOCK = [
  ['TV-23', 'Clonal', 75000, 25000, 5000, 45000, 32000],
  ['TV-26', 'Clonal', 65000, 18500, 3000, 43500, 0],
  ['S-15', 'Seedling', 40000, 15000, 2000, 23000, 0],
  ['R-1', 'Clonal', 30000, 8000, 1000, 21000, 0],
] as const;

export async function seedNurseries(
  db: Database,
  userId: string,
  estates: Record<string, string>,
  divisions: Record<string, string>,
): Promise<number> {
  let count = 0;
  const jte = estates['JTE-001'];
  const div01 = divisions['JTE-001/DIV-01'];
  if (jte && div01) {
    const central = await seedOne(
      db,
      userId,
      'nursery',
      { estate: jte, nurseryCode: 'NUR-01' },
      {
        estate: jte,
        division: div01,
        nurseryName: 'Central Nursery',
        supervisor: 'Md. Faruk Hossain',
        nurseryCode: 'NUR-01',
        nurseryType: 'Clonal',
        location: 'Uttarkhan, Rangpur',
        irrigationSource: 'Tube Well',
        establishedYear: 2020,
        status: 'Active',
        totalArea: 5.6,
        netUsableArea: 4.8,
        active: 'Tea Research Institute',
        remarks: 'Central nursery for clonal plant production.',
      },
    );
    if (!(await db.nurseryBed.count({ where: { nurseryId: central } })))
      await db.nurseryBed.createMany({
        data: BEDS.map(([name, code, clone, area, plants, date, status], position) => ({
          id: newId(),
          nurseryId: central,
          position,
          name,
          code,
          clone,
          area,
          plants,
          plantingDate: new Date(`${date}T00:00:00.000Z`),
          status,
        })),
      });
    if (!(await db.nurseryStock.count({ where: { nurseryId: central } })))
      await db.nurseryStock.createMany({
        data: STOCK.map(([clone, type, total, available, reserved, distributed, thisMonth], position) => ({
          id: newId(),
          nurseryId: central,
          position,
          clone,
          type,
          totalPlants: total,
          availablePlants: available,
          reservedPlants: reserved,
          distributedPlants: distributed,
          distributedThisMonth: thisMonth,
          unit: 'Nos',
        })),
      });
    count += 1;
  }
  const tge = estates['TGE-002'];
  const tgeDiv = divisions['TGE-002/DIV-01'];
  if (tge && tgeDiv) {
    await seedOne(
      db,
      userId,
      'nursery',
      { estate: tge, nurseryCode: 'NUR-01' },
      {
        estate: tge,
        division: tgeDiv,
        nurseryName: 'Tetulia Seedling Nursery',
        supervisor: 'Abdul Karim',
        nurseryCode: 'NUR-01',
        nurseryType: 'Seedling',
        location: 'Tetulia, Panchagarh',
        irrigationSource: 'Deep Tube Well',
        establishedYear: 2022,
        status: 'Active',
        totalArea: 2.4,
        netUsableArea: 2,
        active: 'BTB',
        remarks: null,
      },
    );
    count += 1;
  }
  return count;
}
