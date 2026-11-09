import { type Database } from '../../src/lib/db.js';
import { seedOne } from './util.js';

/**
 * RP1-108 sample calendar: the prototype's 20 sales (auctionSheduleData.js). The prototype's season
 * "2026-2027" is not a saved season, so the rows use the 2026 Main Season (MS-2026), whose dates hold every
 * sale, and Chattogram Tea Auction Centre (AC-003). Added once (by sale number).
 */
const SALE_DATES = [
  '2026-04-27',
  '2026-05-04',
  '2026-05-11',
  '2026-05-18',
  '2026-06-01',
  '2026-06-08',
  '2026-06-15',
  '2026-06-22',
  '2026-06-29',
  '2026-07-06',
  '2026-07-13',
  '2026-07-20',
  '2026-07-27',
  '2026-08-03',
  '2026-08-10',
  '2026-08-17',
  '2026-08-24',
  '2026-08-31',
  '2026-09-07',
  '2026-09-14',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const eightDaysBefore = (iso: string) => new Date(day(iso).getTime() - 8 * 86_400_000);

export async function seedAuctionSchedules(db: Database, userId: string): Promise<number> {
  const season = await db.season.findFirst({ where: { seasonCode: 'MS-2026', deletedAt: null } });
  const center = await db.auctionCenter.findFirst({ where: { centerCode: 'AC-003', deletedAt: null } });
  if (!season || !center) return 0;
  for (const [i, saleDate] of SALE_DATES.entries()) {
    const holiday = i === 4;
    await seedOne(
      db,
      userId,
      'auctionSchedule',
      { season: season.id, auctionCenter: center.id, saleNo: i + 1 },
      {
        season: season.id,
        auctionCenter: center.id,
        year: '2026-2027',
        saleNo: i + 1,
        saleDate: day(saleDate),
        saleDay: DAYS[day(saleDate).getUTCDay()],
        buyerPromptDate: eightDaysBefore(saleDate),
        catalogueClosingDate: eightDaysBefore(saleDate),
        comments: holiday ? 'Holiday' : null,
        status: holiday ? 'HOLIDAY' : 'SCHEDULED',
      },
    );
  }
  return SALE_DATES.length;
}
