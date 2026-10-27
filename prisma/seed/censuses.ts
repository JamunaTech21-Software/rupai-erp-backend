import { type Database } from '../../src/lib/db.js';
import { writeHistory } from '../../src/lib/history.js';
import { newId } from '../../src/lib/ids.js';

/**
 * RP1-20 sample plant census: the prototype's `rowWiseTable` (R-01 to R-05) on the seeded BLK-01, with the
 * gap worked out as the API does. Added once (by field and census date).
 */
const ROWS = [
  ['R-01', 245, 2.15, 526, 498, 28, 0],
  ['R-02', 248, 2.18, 541, 512, 29, 0],
  ['R-03', 250, 2.1, 525, 497, 28, 0],
  ['R-04', 240, 2.05, 492, 466, 26, 0],
  ['R-05', 245, 2.12, 519, 491, 28, 0],
] as const;

export async function seedCensuses(
  db: Database,
  userId: string,
  fieldIds: Record<string, string>,
): Promise<number> {
  const fieldId = fieldIds['BLK-01'];
  const field = fieldId ? await db.fieldBlock.findUnique({ where: { id: fieldId } }) : null;
  if (!field) return 0;
  const censusDate = new Date('2026-05-20T00:00:00.000Z');
  if (await db.plantCensus.findFirst({ where: { fieldBlock: field.id, censusDate, deletedAt: null } }))
    return 1;
  const id = newId();
  const census = {
    id,
    estate: field.estate,
    division: field.division,
    section: field.section,
    fieldBlock: field.id,
    censusDate,
    censusYear: 2026,
    surveyType: 'full',
    rowFrom: 1,
    rowTo: 5,
    totalSelectedRows: 5,
    rowSpacing: 1.2,
    plantingYear: 2018,
    cloneVariety: 'tv1',
    elevation: 85,
    plantSpacing: 0.6,
    censusBy: 'Md. Faruk Hossain',
    supervisor: 'sup-1',
    censusMethod: 'manual',
    remarks: 'Annual census of the selected rows.',
    photos: [],
    documents: [],
    createdBy: userId,
    updatedBy: userId,
  };
  await db.$transaction(async (tx) => {
    await tx.plantCensus.create({ data: census });
    await tx.plantCensusRow.createMany({
      data: ROWS.map(
        (
          [rowNo, rowLength, plantsPerMeter, expectedPlants, livePlants, deadPlants, missingPlants],
          position,
        ) => ({
          id: newId(),
          censusId: id,
          position,
          rowNo,
          rowLength,
          plantsPerMeter,
          expectedPlants,
          livePlants,
          deadPlants,
          missingPlants,
          gapPercentage: Math.round(((deadPlants + missingPlants) / expectedPlants) * 10000) / 100,
        }),
      ),
    });
    await writeHistory(tx, {
      resource: 'plantCensus',
      recordId: id,
      action: 'create',
      newData: census,
      userId,
    });
  });
  return 1;
}
