import { type Database } from '../../src/lib/db.js';
import { writeHistory } from '../../src/lib/history.js';
import { newId } from '../../src/lib/ids.js';

/**
 * RP1-19 sample replanting projects: the prototype's "Replanting Project 2026" with all eight steps from
 * `stepForms` (its BLK-08 becomes the seeded BLK-02), and a second project saved at step 1 only. Added
 * once (by project name).
 */
const d = (v: string) => new Date(`${v}T00:00:00.000Z`);
const rows = <T extends object>(replantingId: string, list: T[]) =>
  list.map((row, position) => ({ ...row, id: newId(), replantingId, position }));

export async function seedReplanting(
  db: Database,
  userId: string,
  fieldIds: Record<string, string>,
): Promise<number> {
  const plans = [
    { projectName: 'Replanting Project 2026', code: 'RP-2026-001', field: 'BLK-02', full: true },
    { projectName: 'Gap Filling BLK-04 2026', code: 'RP-2026-002', field: 'BLK-04', full: false },
  ];
  let count = 0;
  for (const plan of plans) {
    const fieldId = fieldIds[plan.field];
    const field = fieldId ? await db.fieldBlock.findUnique({ where: { id: fieldId } }) : null;
    if (!field) continue;
    count += 1;
    if (await db.replantingProject.findFirst({ where: { projectName: plan.projectName, deletedAt: null } }))
      continue;
    const id = newId();
    const project = {
      id,
      projectCode: plan.code,
      projectName: plan.projectName,
      estate: field.estate,
      division: field.division,
      section: field.section,
      fieldBlock: field.id,
      replantingType: plan.full ? 'Replanting' : 'Gap Filling',
      season: 'Monsoon (Jun - Jul)',
      surveyDate: d('2026-05-10'),
      targetDate: d('2026-06-01'),
      supervisor: 'Md. Faruk Hossain',
      remarks: plan.full ? 'Old bushes are low yielding.' : null,
      ...(plan.full
        ? {
            gapSurveyDate: d('2026-05-10'),
            surveyBy: 'Field Officer',
            plantVariety: 'TV-23',
            planningDate: d('2026-05-28'),
            store: 'Central Store',
            preparedBy: 'Store Officer',
            materialRemarks: 'Materials allocated as per plantation requirement.',
            labourSource: 'Local',
            wageType: 'Daily Wage',
            plantingDate: d('2026-06-09'),
            cloneVariety: 'TV-23',
            tillDate: d('2026-06-01'),
            completionDate: d('2026-07-20'),
            survival90Days: 92,
            completionRemarks: 'Replanting completed successfully.',
            lastStep: 8,
          }
        : { lastStep: 1 }),
      createdBy: userId,
      updatedBy: userId,
    };
    await db.$transaction(async (tx) => {
      await tx.replantingProject.create({ data: project });
      if (plan.full) {
        await tx.replantingGap.createMany({
          data: rows(
            id,
            (
              [
                ['GAP-001', 0.25, 250, 'Small'],
                ['GAP-002', 0.4, 400, 'Medium'],
                ['GAP-003', 0.6, 600, 'Large'],
                ['GAP-004', 0.3, 300, 'Small'],
                ['GAP-005', 0.15, 150, 'Small'],
              ] as const
            ).map(([gapId, gapSize, plants, gapType]) => ({ gapId, gapSize, plants, gapType })),
          ),
        });
        await tx.replantingPreparation.createMany({
          data: rows(id, [
            {
              activity: 'Clearing',
              startDate: d('2026-05-12'),
              endDate: d('2026-05-16'),
              status: 'Completed',
            },
            {
              activity: 'Stumping / Felling',
              startDate: d('2026-05-17'),
              endDate: d('2026-05-21'),
              status: 'Completed',
            },
            {
              activity: 'Land Preparation',
              startDate: d('2026-05-22'),
              endDate: d('2026-05-28'),
              status: 'In Progress',
            },
            {
              activity: 'Pit Digging',
              startDate: d('2026-05-29'),
              endDate: d('2026-06-05'),
              status: 'Pending',
            },
          ]),
        });
        await tx.replantingMaterial.createMany({
          data: rows(
            id,
            (
              [
                ['NPK (15:15:15)', 525, 55],
                ['TSP', 315, 40],
                ['MOP', 315, 38],
                ['FYM', 3000, 4],
                ['Lime', 250, 6],
                ['Neem Cake', 150, 20],
              ] as const
            ).map(([material, requiredQty, unitCost]) => ({
              material,
              unit: 'Kg',
              requiredQty,
              unitCost,
              totalCost: requiredQty * unitCost,
            })),
          ),
        });
        await tx.replantingLabour.createMany({
          data: rows(
            id,
            (
              [
                ['Field Worker', 30, 25, 450],
                ['Skilled Worker', 10, 5, 550],
                ['Supervisor', 2, 1, 800],
              ] as const
            ).map(([labourType, male, female, rate]) => ({
              labourType,
              male,
              female,
              rate,
              amount: (male + female) * rate,
            })),
          ),
        });
        await tx.replantingPlantingRow.createMany({
          data: rows(
            id,
            [1, 2, 3, 4].map((rowNo) => ({
              rowNo,
              fromPlant: (rowNo - 1) * 250 + 1,
              toPlant: rowNo * 250,
              plants: 250,
              plantedBy: `Team-0${rowNo}`,
            })),
          ),
        });
        await tx.replantingProgress.createMany({
          data: rows(id, [
            {
              date: d('2026-05-25'),
              areaCompleted: 0.8,
              plantsPlanted: 800,
              survival: null,
              remarks: 'Land Preparation',
            },
            {
              date: d('2026-05-30'),
              areaCompleted: 1.2,
              plantsPlanted: 1000,
              survival: null,
              remarks: 'Pit Digging',
            },
            {
              date: d('2026-06-01'),
              areaCompleted: 1.25,
              plantsPlanted: 1000,
              survival: 92,
              remarks: 'Planting Completed',
            },
          ]),
        });
        await tx.replantingApproval.createMany({
          data: rows(id, [
            {
              level: 'Field Officer',
              name: 'Fazlu Hossain',
              designation: 'FO',
              status: 'Approved',
              date: d('2026-06-01'),
            },
            {
              level: 'Estate Manager',
              name: 'Kamrul Hasan',
              designation: 'EM',
              status: 'Approved',
              date: d('2026-06-03'),
            },
            { level: 'GM (Estate)', name: 'Rafiq Uddin', designation: 'GM', status: 'Pending', date: null },
            {
              level: 'Head Office',
              name: 'Md. Saad',
              designation: 'Director',
              status: 'Pending',
              date: null,
            },
          ]),
        });
      }
      await writeHistory(tx, {
        resource: 'replantingProject',
        recordId: id,
        action: 'create',
        newData: project,
        userId,
      });
    });
  }
  return count;
}
