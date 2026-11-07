import { type Database } from '../../src/lib/db.js';
import { seedOne } from './util.js';

/**
 * RP1-105 sample centers: the prototype's selected center and Other Auction Centers (auctionCentersData.js).
 * The prototype's list has no address, phone, division or auction days for the other four, so these are filled
 * with plain samples. Added once (by code).
 */
const CENTERS = [
  ['AC-001', 'Sreemangal Tea Auction Centre', 'sreemangal', 'sylhet', 'ttab'],
  ['AC-002', 'Panchagarh Tea Auction Centre', 'panchagarh', 'rangpur', 'small-tea-garden'],
  ['AC-004', 'Sylhet Tea Auction Centre', 'sylhet', 'sylhet', 'ttab'],
  ['AC-005', 'Bangladesh Small Tea Auction Centre', 'sreemangal', 'sylhet', 'ttab'],
] as const;

const COMMON = {
  auctionStartTime: '10:30',
  timeZone: 'gmt6',
  currency: 'bdt',
  regulatoryAuthority: 'bangladesh-tea-board',
  status: 'active',
};

export async function seedAuctionCenters(db: Database, userId: string): Promise<number> {
  await seedOne(
    db,
    userId,
    'auctionCenter',
    { centerCode: 'AC-003' },
    {
      ...COMMON,
      centerCode: 'AC-003',
      centerName: 'Chattogram Tea Auction Centre',
      shortName: 'CTAC',
      address: 'Tea Auction Complex, Agrabad, Chattogram-4100, Bangladesh.',
      cityDistrict: 'chattogram',
      division: 'chattogram',
      contactPerson: 'Mr. Abdul Karim',
      phone: '+880 31 251 0501',
      email: 'ctac@teaboard.gov.bd',
      auctionDays: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'],
      managedBy: 'ttab',
      establishedOn: new Date('1958-07-01T00:00:00Z'),
    },
  );
  for (const [centerCode, centerName, cityDistrict, division, managedBy] of CENTERS)
    await seedOne(
      db,
      userId,
      'auctionCenter',
      { centerCode },
      {
        ...COMMON,
        centerCode,
        centerName,
        address: `${centerName}, Bangladesh.`,
        cityDistrict,
        division,
        phone: '+880 31 251 0501',
        auctionDays: ['monday'],
        managedBy,
      },
    );
  return CENTERS.length + 1;
}
