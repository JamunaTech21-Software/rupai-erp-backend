import { type Database } from '../../src/lib/db.js';
import { seedOne } from './util.js';

/**
 * RP1-54 sample mouzas: the prototype's `mouzas` options (landAndLeaseManagementData.js) for every seeded
 * estate. Added once (by estate and name). Returns ids by `<estate code>/<mouza name>`.
 */
const NAMES = [
  ['Madhabpur', 'JL-45'],
  ['Shahapur', 'JL-46'],
  ['Kashimpur', 'JL-47'],
  ['Uttarkhan', 'JL-48'],
  ['Rupganj', 'JL-49'],
] as const;

export async function seedMouzas(
  db: Database,
  userId: string,
  estates: Record<string, string>,
): Promise<Record<string, string>> {
  const mouzas: Record<string, string> = {};
  for (const [estateCode, estate] of Object.entries(estates))
    for (const [mouzaName, jlNo] of NAMES)
      mouzas[`${estateCode}/${mouzaName}`] = await seedOne(
        db,
        userId,
        'mouza',
        { estate, mouzaName },
        { estate, mouzaName, jlNo, remarks: null },
      );
  return mouzas;
}
