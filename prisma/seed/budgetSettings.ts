import { type Database } from '../../src/lib/db.js';
import { BUDGET_SETTINGS_ID, defaultSettings } from '../../src/modules/budget/settings.js';

/** RP1-239: the Budget Settings of image 3, added once (a saved row is left as it is). */
export async function seedBudgetSettings(db: Database, userId: string): Promise<number> {
  if (await db.budgetSettings.count({ where: { id: BUDGET_SETTINGS_ID } })) return 0;
  await db.budgetSettings.create({
    data: { id: BUDGET_SETTINGS_ID, ...defaultSettings(), updatedBy: userId },
  });
  return 1;
}
