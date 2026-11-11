import { type Database } from '../../src/lib/db.js';
import { DEFAULT_SETTINGS, SETTINGS_ID } from '../../src/modules/documents/expiry.js';

/** RP1-145: the global Expiry & Renewal settings of image 4, added once (a saved row is left as it is). */
export async function seedDocumentSettings(db: Database, userId: string): Promise<number> {
  if (await db.documentSettings.count({ where: { id: SETTINGS_ID } })) return 0;
  await db.documentSettings.create({ data: { id: SETTINGS_ID, ...DEFAULT_SETTINGS, updatedBy: userId } });
  return 1;
}
