import { type Database } from '../../src/lib/db.js';
import { writeHistory } from '../../src/lib/history.js';
import { newId } from '../../src/lib/ids.js';

/**
 * RP1-12 sample estates. The first is the prototype's own (`estateProfileData.js`); the others give the
 * list, filters and summary something to show. An estate whose code already exists is left as it is, so
 * edits made in the dashboard survive a re-seed. Returns estate ids by code for later stories.
 */
const ESTATES = [
  {
    estateName: 'Jamuna Tea Estate',
    estateCode: 'JTE-001',
    establishedYear: 1998,
    companyOwner: 'Jamuna Tea Company Ltd.',
    estateType: 'company_owned',
    estateCategory: 'large_estate',
    address: 'Panchagarh Sadar, Panchagarh, Bangladesh',
    policeStation: 'Panchagarh Sadar',
    district: 'Panchagarh',
    division: 'Rangpur',
    country: 'Bangladesh',
    zipCode: '5020',
    phone: '+8801712345678',
    email: 'info@jamunateaestate.com',
    website: 'https://www.jamunateaestate.com',
    totalLandArea: 5250,
    teaArea: 4120,
    nonTeaArea: 1130,
    totalFieldBlock: 48,
    totalDivision: 6,
    totalSection: 24,
    totalWorker: 1250,
    totalFamily: 980,
    selectedFacilities: [
      'factory',
      'warehouse',
      'staff_quarter',
      'hospital',
      'school',
      'playground',
      'religious_place',
      'electricity',
      'water_supply',
      'transport',
      'canteen',
      'club_library',
    ],
    otherFacilityName: null,
    latitude: 26.3417,
    longitude: 88.0008,
    description:
      'Jamuna Tea Estate is one of the largest tea estates in northern Bangladesh. Established in 1998, the estate is situated in Panchagarh district under Rangpur division. The estate produces premium CTC and Orthodox tea while operating modern processing facilities, worker residential areas, schools, healthcare services, warehouses and transport systems.',
    managers: [
      {
        type: 'estate_manager',
        name: 'Md. Rahman Ali',
        mobile: '+8801711122233',
        email: 'manager@jamunateaestate.com',
      },
      {
        type: 'assistant_manager',
        name: 'Md. Faruk Hossain',
        mobile: '+8801713344556',
        email: 'asst.manager@jamunateaestate.com',
      },
    ],
  },
  {
    estateName: 'Tetulia Green Estate',
    estateCode: 'TGE-002',
    establishedYear: 2005,
    companyOwner: 'Jamuna Tea Company Ltd.',
    estateType: 'company_owned',
    estateCategory: 'medium_estate',
    address: 'Tetulia, Panchagarh, Bangladesh',
    policeStation: 'Tetulia',
    district: 'Panchagarh',
    division: 'Rangpur',
    country: 'Bangladesh',
    zipCode: '5030',
    phone: '+8801812345678',
    email: 'info@tetuliagreen.com',
    website: null,
    totalLandArea: 1850,
    teaArea: 1420,
    nonTeaArea: 430,
    totalFieldBlock: 18,
    totalDivision: 3,
    totalSection: 9,
    totalWorker: 460,
    totalFamily: 350,
    selectedFacilities: ['factory', 'staff_quarter', 'school', 'electricity', 'water_supply'],
    otherFacilityName: 'Guest House',
    latitude: 26.4833,
    longitude: 88.35,
    description: 'Medium estate near the Tetulia border, producing CTC tea.',
    managers: [
      { type: 'estate_manager', name: 'Md. Kamal Uddin', mobile: '+8801811122233', email: null },
      { type: 'assistant_manager', name: 'Shirin Akter', mobile: '+8801813344556', email: null },
    ],
  },
  {
    estateName: 'Lalmonirhat Hill Estate',
    estateCode: 'LHE-003',
    establishedYear: 2012,
    companyOwner: 'Hill Tea Ltd.',
    estateType: 'private_estate',
    estateCategory: 'small_estate',
    address: 'Patgram, Lalmonirhat, Bangladesh',
    policeStation: 'Patgram',
    district: 'Lalmonirhat',
    division: 'Rangpur',
    country: 'Bangladesh',
    zipCode: '5540',
    phone: null,
    email: null,
    website: null,
    totalLandArea: 640,
    teaArea: 510,
    nonTeaArea: 130,
    totalFieldBlock: 7,
    totalDivision: 2,
    totalSection: 4,
    totalWorker: 150,
    totalFamily: 110,
    selectedFacilities: ['warehouse', 'electricity'],
    otherFacilityName: null,
    latitude: 26.3567,
    longitude: 89.0333,
    description: null,
    managers: [{ type: 'estate_manager', name: 'Abdul Karim', mobile: '+8801911122233', email: null }],
  },
];

export async function seedEstates(db: Database, userId: string): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const { managers, ...estate } of ESTATES) {
    const existing = await db.estate.findFirst({ where: { estateCode: estate.estateCode, deletedAt: null } });
    if (existing) {
      ids[estate.estateCode] = existing.id;
      continue;
    }
    const id = newId();
    await db.$transaction(async (tx) => {
      await tx.estate.create({
        data: { ...estate, id, estateImages: [], createdBy: userId, updatedBy: userId },
      });
      await tx.estateManager.createMany({
        data: managers.map((m, position) => ({ ...m, id: newId(), estateId: id, position })),
      });
      await writeHistory(tx, {
        resource: 'estate',
        recordId: id,
        action: 'create',
        newData: { id, ...estate, estateImages: [], managers },
        userId,
      });
    });
    ids[estate.estateCode] = id;
  }
  return ids;
}
