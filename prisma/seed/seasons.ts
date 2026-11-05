import { type Database } from '../../src/lib/db.js';
import { seedOne } from './util.js';

/** RP1-93 sample seasons: the prototype's Season List (seasonData.js). Added once (by code). */
const SEASONS = [
  ['2026 Main Season', 'MS-2026', 'main', '2026-01-01', '2026-12-31', 'active'],
  ['2025 Main Season', 'MS-2025', 'main', '2025-01-01', '2025-12-31', 'completed'],
  ['2025 Off Season', 'OS-2025', 'off-season', '2025-07-01', '2025-09-30', 'completed'],
  ['2024 Main Season', 'MS-2024', 'main', '2024-01-01', '2024-12-31', 'completed'],
  ['2024 Off Season', 'OS-2024', 'off-season', '2024-07-01', '2024-09-30', 'completed'],
] as const;

export async function seedSeasons(db: Database, userId: string): Promise<number> {
  for (const [seasonName, seasonCode, seasonType, start, end, status] of SEASONS)
    await seedOne(
      db,
      userId,
      'season',
      { seasonCode },
      {
        seasonName,
        seasonCode,
        seasonType,
        startDate: new Date(`${start}T00:00:00Z`),
        endDate: new Date(`${end}T00:00:00Z`),
        status,
        description: status === 'active' ? 'Main tea production season for the year 2026.' : null,
        remarks: null,
      },
    );
  return SEASONS.length;
}
