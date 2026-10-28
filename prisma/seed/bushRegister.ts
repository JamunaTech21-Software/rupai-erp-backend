import { type Database } from '../../src/lib/db.js';
import { writeHistory } from '../../src/lib/history.js';
import { newId } from '../../src/lib/ids.js';

/**
 * RP1-21 sample bush register: the prototype's `bushRegisterList` (R-001 to R-005) and gap sizes on the
 * seeded BLK-02 (its BLK-08), with each gap worked out as the API does. Added once (by field and survey date).
 */
const ROWS = [
  ['R-001', 1, 100, 500, 470, 15, 15, 70.5, 92.0, 'Good'],
  ['R-002', 101, 200, 500, 458, 20, 22, 71.0, 93.2, 'Good'],
  ['R-003', 201, 300, 500, 452, 25, 23, 69.8, 91.5, 'Fair'],
  ['R-004', 301, 400, 500, 460, 18, 22, 72.3, 95.0, 'Good'],
  ['R-005', 401, 500, 500, 470, 12, 18, 73.0, 97.5, 'Good'],
] as const;

export async function seedBushRegister(
  db: Database,
  userId: string,
  fieldIds: Record<string, string>,
): Promise<number> {
  const fieldId = fieldIds['BLK-02'];
  const field = fieldId ? await db.fieldBlock.findUnique({ where: { id: fieldId } }) : null;
  if (!field) return 0;
  const surveyDate = new Date('2026-05-15T00:00:00.000Z');
  if (await db.bushRegister.findFirst({ where: { fieldBlock: field.id, surveyDate, deletedAt: null } }))
    return 1;
  const id = newId();
  const register = {
    id,
    estate: field.estate,
    division: field.division,
    section: field.section,
    fieldBlock: field.id,
    plantingYear: field.plantingYear,
    bushAge: surveyDate.getUTCFullYear() - field.plantingYear,
    totalArea: 25.6,
    rowSpacing: 4,
    plantSpacing: 2,
    surveyDate,
    surveyor: 'md-faruk-hossain',
    bushStatus: 'productive',
    bushHealth: 'good',
    productionZone: 'zone-a',
    rowDirection: 'north-south',
    smallGaps: 980,
    mediumGaps: 860,
    largeGaps: 560,
    createdBy: userId,
    updatedBy: userId,
  };
  await db.$transaction(async (tx) => {
    await tx.bushRegister.create({ data: register });
    await tx.bushRegisterRow.createMany({
      data: ROWS.map(([rowNo, from, to, totalBush, productive, dead, missing, height, spread, health]) => ({
        id: newId(),
        registerId: id,
        rowNo,
        from,
        to,
        totalBush,
        productive,
        dead,
        missing,
        gap: Math.round(((dead + missing) / totalBush) * 10000) / 100,
        height,
        spread,
        health,
        remarks: null,
      })),
    });
    await writeHistory(tx, {
      resource: 'bushRegister',
      recordId: id,
      action: 'create',
      newData: register,
      userId,
    });
  });
  return 1;
}
