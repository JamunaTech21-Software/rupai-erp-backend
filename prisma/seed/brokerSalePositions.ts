import { type Database } from '../../src/lib/db.js';
import { newId } from '../../src/lib/ids.js';
import { seedOne } from './util.js';

/**
 * RP1-114 sample positions: the prototype's Brokers Sale Position List (brokerSalePositionData.js). Its seven
 * brokers are added as saved brokers (the prototype has only their names, so code, license, contact and
 * address are plain samples), and Sreemangal and Panchagarh get Sale 1 and 2 in the 2026 Main Season, on the
 * Chattogram dates, so every position has its sale. Added once (by code / sale).
 */
const BROKERS = [
  'National Brokers Limited',
  'Purba Bangla Brokers Limited',
  'K.S Brokers Limited',
  'Planters Brokers Limited',
  'Unity Brokers Limited',
  'Progressive Brokers Ltd',
  'Produce Brokers Limited',
];
const POSITIONS = [
  ['AC-003', 1],
  ['AC-003', 2],
  ['AC-003', 3],
  ['AC-001', 1],
  ['AC-001', 2],
  ['AC-002', 1],
  ['AC-002', 2],
] as const;
const SALES = [
  ['2026-04-27', '2026-04-19'],
  ['2026-05-04', '2026-04-26'],
] as const;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

export async function seedBrokerSalePositions(db: Database, userId: string): Promise<number> {
  const season = await db.season.findFirst({ where: { seasonCode: 'MS-2026', deletedAt: null } });
  const centers = await db.auctionCenter.findMany({
    where: { centerCode: { in: ['AC-001', 'AC-002', 'AC-003'] }, deletedAt: null },
    select: { id: true, centerCode: true },
  });
  const center = (code: string) => centers.find((c) => c.centerCode === code)?.id;
  if (!season || centers.length !== 3) return 0;
  const all = centers.map((c) => c.id);

  const brokers: string[] = [];
  for (const [i, brokerName] of BROKERS.entries()) {
    const brokerCode = `BRK-00${i + 1}`;
    const id = await seedOne(
      db,
      userId,
      'broker',
      { brokerCode },
      {
        brokerCode,
        brokerName,
        licenseNo: `BRK/2026/00${i + 1}`,
        contactPersonName: 'Managing Director',
        designation: 'MANAGER',
        commission: 1,
        status: 'active',
        address: 'Agrabad Commercial Area, Chattogram, Bangladesh.',
        auctionCenters: all,
        association: 'TTAB',
      },
    );
    if (!(await db.brokerMobile.count({ where: { brokerId: id } })))
      await db.brokerMobile.create({
        data: {
          id: newId(),
          brokerId: id,
          position: 0,
          mobileNumber: `01711-00000${i + 1}`,
          type: 'PRIMARY',
          isPrimary: true,
        },
      });
    brokers.push(id);
  }

  for (const code of ['AC-001', 'AC-002'])
    for (const [i, [saleDate, closing]] of SALES.entries())
      await seedOne(
        db,
        userId,
        'auctionSchedule',
        { season: season.id, auctionCenter: center(code), saleNo: i + 1 },
        {
          season: season.id,
          auctionCenter: center(code),
          year: '2026-2027',
          saleNo: i + 1,
          saleDate: day(saleDate),
          saleDay: 'Monday',
          buyerPromptDate: day(closing),
          catalogueClosingDate: day(closing),
          status: 'SCHEDULED',
        },
      );

  for (const [code, saleNo] of POSITIONS) {
    const sale = await db.auctionSchedule.findFirst({
      where: { season: season.id, auctionCenter: center(code), saleNo, deletedAt: null },
    });
    if (!sale) continue;
    await seedOne(
      db,
      userId,
      'brokerSalePosition',
      { auctionSchedule: sale.id },
      {
        auctionCenter: center(code),
        auctionSchedule: sale.id,
        ...Object.fromEntries(brokers.map((id, i) => [`broker${i + 1}`, id])),
        status: 'active',
      },
    );
  }
  return POSITIONS.length;
}
