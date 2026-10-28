import { type Database } from '../../src/lib/db.js';
import { writeHistory } from '../../src/lib/history.js';
import { newId } from '../../src/lib/ids.js';
import { placeholderPdf } from './util.js';

/**
 * RP1-23 sample workers: the Worker Management page's eight (`workerManagementData.workers`), filled in with
 * the Add New Worker form's option values. The first has the form's land and dependent tables. NID front and
 * back (required) are small placeholder PDFs. Added once (by worker id).
 */
const WORKERS = [
  [
    'WRK-10001',
    'Rupa Rani',
    'Tanti',
    'Nirmal Chandra Tanti',
    'Shanti Rani Tanti',
    'tea-plucking',
    'section-a',
    '01712345678',
    '2023-01-12',
    '1995-03-10',
    'female',
    'permanent',
    'active',
  ],
  [
    'WRK-10002',
    'Maya',
    'Barman',
    'Kamal Barman',
    'Mina Barman',
    'tea-plucking',
    'section-a',
    '01798765432',
    '2023-02-05',
    '1993-06-18',
    'female',
    'permanent',
    'active',
  ],
  [
    'WRK-10003',
    'Purnima',
    'Roy',
    'Haripada Roy',
    'Maya Roy',
    'pruning',
    'section-b',
    '01822334455',
    '2023-01-20',
    '1990-11-22',
    'female',
    'permanent',
    'active',
  ],
  [
    'WRK-10004',
    'Jharna',
    'Das',
    'Gopal Das',
    'Rina Das',
    'weeding',
    'section-c',
    '01766778899',
    '2023-03-10',
    '1992-08-14',
    'female',
    'temporary',
    'active',
  ],
  [
    'WRK-10005',
    'Babulal',
    'Sutradhaar',
    'Dilip Sutradhaar',
    'Kamala Sutradhaar',
    'tea-plucking',
    'section-d',
    '01833112233',
    '2023-02-18',
    '1988-05-02',
    'male',
    'permanent',
    'active',
  ],
  [
    'WRK-10006',
    'Lata Rani',
    'Saha',
    'Nabin Saha',
    'Mina Rani Saha',
    'tea-plucking',
    'section-a',
    '01744556677',
    '2023-01-22',
    '1991-09-09',
    'female',
    'permanent',
    'on-leave',
  ],
  [
    'WRK-10007',
    'Ratan',
    'Tanti',
    'Bhola Tanti',
    'Shila Tanti',
    'pruning',
    'section-b',
    '01888998877',
    '2023-03-15',
    '1987-04-17',
    'male',
    'permanent',
    'active',
  ],
  [
    'WRK-10008',
    'Sukur',
    'Ali',
    'Halima Begum',
    'Rahima Begum',
    'weeding',
    'section-d',
    '01799887766',
    '2023-02-01',
    '1989-12-25',
    'male',
    'temporary',
    'active',
  ],
] as const;

const d = (v: string) => new Date(`${v}T00:00:00.000Z`);

export async function seedWorkers(db: Database, userId: string): Promise<number> {
  for (const [i, w] of WORKERS.entries()) {
    const [
      workerId,
      firstName,
      lastName,
      fathersName,
      mothersName,
      jobTask,
      section,
      mobileNo,
      joined,
      born,
      gender,
      workerType,
      status,
    ] = w;
    if (await db.worker.findFirst({ where: { workerId, deletedAt: null } })) continue;
    const id = newId();
    const first = i === 0;
    const worker = {
      id,
      workerId,
      workerType,
      category: jobTask === 'tea-plucking' ? 'general-worker' : 'semi-skilled-worker',
      title: gender === 'female' ? 'mrs' : 'mr',
      firstName,
      middleName: null,
      lastName,
      fathersName,
      mothersName,
      dateOfBirth: d(born),
      gender,
      bloodGroup: 'b-positive',
      maritalStatus: 'married',
      nationality: 'bangladeshi',
      religion: lastName === 'Ali' ? 'islam' : 'hinduism',
      tinNo: null,
      gardenUnit: 'jamuna-tea-estate',
      section,
      jobTask,
      workerStatus: status,
      joinDate: d(joined),
      employmentType: workerType,
      jobNature: 'field-work',
      numberOfDependents: first ? 3 : 0,
      reportingTo: 'section-manager',
      workingLocation: 'field',
      employmentStatus: status,
      probationEndDate: null,
      mobileNo,
      alternateMobile: null,
      personalEmail: null,
      presentAddress: 'Line No. 4, Jamuna Tea Estate, Sreemangal',
      permanentAddress: 'Line No. 4, Jamuna Tea Estate, Sreemangal',
      sameAsPresentAddress: true,
      district: 'moulvibazar',
      upazila: 'sreemangal',
      postalCode: '3210',
      workerPhoto: null,
      face: null,
      rightThumb: null,
      leftThumb: null,
      landDistributed: first ? 'yes' : 'no',
      landType: first ? 'agricultural' : null,
      totalLand: first ? 1.25 : null,
      resonCardNo: first ? 'RC-2023-0001' : null,
      issueDate: first ? d('2023-01-15') : null,
      validTill: first ? d('2027-01-14') : null,
      reasonDealerOffice: first ? 'Jamuna Ration Office' : null,
      resonCardFile: null,
      educationLevel: 'primary',
      skillTraining: jobTask === 'tea-plucking' ? 'tea-plucking' : 'gardening',
      languageKnown: 'bangla',
      experienceYear: 3,
      emergencyContactName: fathersName,
      emergencyContactNo: null,
      bankName: null,
      accountNo: null,
      mobileBanking: mobileNo,
      nidFront: await placeholderPdf(db, userId, `${workerId}-nid-front.pdf`),
      nidBack: await placeholderPdf(db, userId, `${workerId}-nid-back.pdf`),
      birthCertificate: null,
      nomineeIdCard: null,
      trainingCertificate: null,
      otherDocument: null,
      createdBy: userId,
      updatedBy: userId,
    };
    const landDetails = first
      ? [
          { plotBlockNo: 'BLK-12 / P-45', mouza: 'Fultali', area: 0.75, distributedDate: d('2023-03-12') },
          { plotBlockNo: 'BLK-16 / P-22', mouza: 'Fultali', area: 0.5, distributedDate: d('2023-07-14') },
        ]
      : [];
    const dependents = first
      ? [
          {
            name: 'Shanti Rani Tanti',
            relation: 'Wife',
            dateOfBirth: d('1995-03-10'),
            occupation: 'House Wife',
          },
          { name: 'Rima Tanti', relation: 'Daughter', dateOfBirth: d('2018-06-05'), occupation: null },
          { name: 'Bappa Tanti', relation: 'Son', dateOfBirth: d('2021-11-11'), occupation: null },
        ]
      : [];
    await db.$transaction(async (tx) => {
      await tx.worker.create({ data: worker });
      await tx.workerLand.createMany({
        data: landDetails.map((row, position) => ({ ...row, id: newId(), workerId: id, position })),
      });
      await tx.workerDependent.createMany({
        data: dependents.map((row, position) => ({ ...row, id: newId(), workerId: id, position })),
      });
      await writeHistory(tx, {
        resource: 'worker',
        recordId: id,
        action: 'create',
        newData: { ...worker, landDetails, dependents },
        userId,
      });
    });
  }
  return WORKERS.length;
}
