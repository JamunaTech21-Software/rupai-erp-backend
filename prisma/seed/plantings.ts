import { type Database } from '../../src/lib/db.js';
import { seedOne } from './util.js';

/**
 * RP1-18 sample field plantings: the prototype's `historyTableData` (10 plantings, 2021–2026). Its blocks
 * (BLK-05…BLK-15) are not seeded fields, so they are spread over the seeded tea fields BLK-01…BLK-04. The
 * first (2026, In Progress) has the prototype's full `plantingInformation`, fertilizer, shade, labour and
 * officer values.
 */
// year, area, clone, date, method, expected, planted
const HISTORY = [
  ['2026', 25.6, 'TV-23', '2026-02-15', 'Manual', 24800, 11160],
  ['2025', 18.3, 'TV-26', '2025-02-20', 'Manual', 17600, 17600],
  ['2025', 16, 'TV-23', '2025-02-18', 'Mechanized', 15500, 15500],
  ['2024', 22.75, 'S-15', '2024-02-10', 'Manual', 21900, 21900],
  ['2024', 20.1, 'R-1', '2024-02-05', 'Manual', 19400, 19400],
  ['2023', 24.2, 'TV-30', '2023-02-12', 'Manual', 23500, 23500],
  ['2023', 19.8, 'BT-6', '2023-02-08', 'Mechanized', 18900, 18900],
  ['2022', 21.4, 'TV-25', '2022-02-16', 'Manual', 20800, 20800],
  ['2022', 17.6, 'TV-23', '2022-02-21', 'Manual', 16700, 16700],
  ['2021', 23, 'TV-26', '2021-02-14', 'Mechanized', 22300, 22300],
] as const;

const FIELDS = ['BLK-01', 'BLK-02', 'BLK-03', 'BLK-04'];

const FIRST = {
  plantSource: 'Central Nursery',
  nurseryBed: 'Bed-02',
  netPlantableArea: 24.8,
  previousCrop: 'Replanting',
  rowSpacing: 4,
  plantSpacing: 2.5,
  pitSize: '18" × 18" × 18"',
  targetPlants: 24600,
  signalPlant: 2,
  soilPH: 5.2,
  elevation: 240,
  slope: '5%',
  drainage: 'Good',
  irrigationSource: 'Tube Well',
  irrigationMethod: 'Sprinkler',
  basalFertilizer: 'NPK 50:50:50 - 20 Kg',
  organicManure: 'FYM - 1000 Kg',
  shadeTreePlanned: true,
  npkAmount: 50,
  npkUnit: 'Kg',
  tspAmount: 25,
  tspUnit: 'Kg',
  mopAmount: 25,
  mopUnit: 'Kg',
  fymAmount: 1000,
  fymUnit: 'Kg',
  shadeTreeSpecies: 'Grevillea Robusta',
  shadeTreeSpacing: '20 × 20 ft',
  shadeTreeCount: 25,
  shadePurpose: 'Shade & Wind Break',
  shadePlantingDate: new Date('2026-02-15T00:00:00.000Z'),
  shadeRemarks: 'Planned along boundary',
  fieldOfficer: 'Md. Faruk Hossain',
  assistantSupervisor: 'Md. Kamrul Hasan',
  totalLabour: 120,
  maleLabour: 80,
  femaleLabour: 40,
  labourSource: 'Local',
  remarks: 'Replanting with high yielding clone TV-23. Land prepared well. Drainage improved.',
};

export async function seedPlantings(
  db: Database,
  userId: string,
  fieldIds: Record<string, string>,
): Promise<number> {
  let count = 0;
  for (const [
    index,
    [year, totalArea, cloneVariety, date, plantingMethod, expectedPlants, plantedPlants],
  ] of HISTORY.entries()) {
    const fieldId = fieldIds[FIELDS[index % FIELDS.length] ?? ''];
    if (!fieldId) continue;
    const field = await db.fieldBlock.findUnique({ where: { id: fieldId } });
    if (!field) continue;
    const plantingDate = new Date(`${date}T00:00:00.000Z`);
    await seedOne(
      db,
      userId,
      'fieldPlanting',
      { fieldBlock: fieldId, plantingDate },
      {
        estate: field.estate,
        division: field.division,
        section: field.section,
        fieldBlock: fieldId,
        plantingYear: Number(year),
        plantingSeason: 'Spring (Feb - Mar)',
        plantingDate,
        plantingMethod,
        plantSource: 'Central Nursery',
        cloneVariety,
        plantType: cloneVariety === 'S-15' ? 'Seedling' : 'Clonal',
        totalArea,
        expectedPlants,
        soilType: 'Loamy',
        documents: [],
        photos: [],
        plantedPlants,
        ...(index === 0 ? FIRST : {}),
      },
    );
    count += 1;
  }
  return count;
}
