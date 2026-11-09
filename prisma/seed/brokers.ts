import { type Database } from '../../src/lib/db.js';
import { newId } from '../../src/lib/ids.js';
import { seedOne } from './util.js';

/**
 * RP1-111 sample broker: the prototype's preview (addBrokerData.js), with its four mobile numbers and its three
 * auction centers (Chattogram, Sreemangal, Panchagarh). The prototype has no address or TIN for it, so the
 * address is a plain sample. Added once (by code).
 */
const MOBILES = [
  ['01711-123456', 'Md. Anisur Rahman', 'PROPRIETOR', 'PRIMARY', true],
  ['01819-123456', 'Aminul Islam', 'MANAGER', 'SECONDARY', false],
  ['01912-345678', 'Kamal Hossain', 'ACCOUNTS_OFFICER', 'WHATSAPP', false],
  ['01617-987654', 'Rashedul Karim', 'MARKETING_EXECUTIVE', 'OTHER', false],
] as const;

export async function seedBrokers(db: Database, userId: string): Promise<number> {
  const centers = await db.auctionCenter.findMany({
    where: { centerCode: { in: ['AC-003', 'AC-001', 'AC-002'] }, deletedAt: null },
    select: { id: true, centerCode: true },
  });
  const order = ['AC-003', 'AC-001', 'AC-002'];
  const auctionCenters = order.flatMap((code) => centers.find((c) => c.centerCode === code)?.id ?? []);
  if (!auctionCenters.length) return 0;
  const brokerId = await seedOne(
    db,
    userId,
    'broker',
    { brokerCode: 'BRK-010' },
    {
      brokerCode: 'BRK-010',
      brokerName: 'ABC Tea Brokers',
      licenseNo: 'BRK/2026/010',
      contactPersonName: 'Md. Anisur Rahman',
      designation: 'PROPRIETOR',
      phone: '01711-123456',
      email: 'abc.teabrokers@gmail.com',
      commission: 2.5,
      status: 'active',
      address: 'Agrabad Commercial Area, Chattogram, Bangladesh.',
      auctionCenters,
      association: 'TTAB',
    },
  );
  if (!(await db.brokerMobile.count({ where: { brokerId } })))
    await db.brokerMobile.createMany({
      data: MOBILES.map(([mobileNumber, contactPersonName, designation, type, isPrimary], position) => ({
        id: newId(),
        brokerId,
        position,
        mobileNumber,
        contactPersonName,
        designation,
        type,
        isPrimary,
      })),
    });
  return 1;
}
