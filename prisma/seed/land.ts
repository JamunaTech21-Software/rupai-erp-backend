import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type Database } from '../../src/lib/db.js';
import { newId } from '../../src/lib/ids.js';
import { uploadRoot } from '../../src/modules/files/service.js';
import { seedOne } from './util.js';

/**
 * RP1-16 sample land / lease records: the prototype's `landLeaseList` (its five estates mapped onto the
 * three seeded ones), with the first record's owner, boundary, 12 lease payments (`paymentList`) and 8
 * documents (`documentList`, each with a small placeholder PDF). Values are the form's option values.
 * Rows still "-" in the prototype (method of an unpaid year) get a planned value, since the form needs one.
 */
type Land = [string, string, string, string, string, number, string | null, string];
const LANDS: Land[] = [
  [
    'Madhabpur Lease Land',
    'JTE-001',
    'leased_in',
    'tea_garden_land',
    'Md. Abul Kalam',
    125.5,
    '20 Years',
    'active',
  ],
  ['Factory Expansion Area', 'JTE-001', 'owned', 'factory_land', 'Jamuna Tea Company', 32.75, null, 'active'],
  ['North Nursery', 'TGE-002', 'owned', 'nursery', 'Rupai Tea Estate', 18.5, null, 'active'],
  [
    'West Residential Zone',
    'LHE-003',
    'leased_out',
    'residential_area',
    'ABC Housing Ltd.',
    14.25,
    '10 Years',
    'inactive',
  ],
  ['South Water Body', 'TGE-002', 'owned', 'water_body', 'Green Valley Tea Estate', 8.9, null, 'active'],
  ['Office Complex', 'LHE-003', 'owned', 'office_area', 'Surma Tea Estate', 12.4, null, 'active'],
  ['Road Side Plot', 'JTE-001', 'disputed', 'road', 'Government', 6.2, null, 'under_process'],
  ['Extension Zone', 'TGE-002', 'leased_in', 'tea_garden_land', 'Md. Harun', 45.8, '15 Years', 'active'],
  ['Warehouse Area', 'LHE-003', 'owned', 'factory_land', 'Karatoa Tea Estate', 22.3, null, 'active'],
  [
    'Worker Colony',
    'LHE-003',
    'leased_out',
    'residential_area',
    'Tea Workers Association',
    15.75,
    '25 Years',
    'active',
  ],
];

const MADHABPUR = {
  mouza: 'madhabpur',
  jlNo: 'JL-45',
  recordType: 'rs_record',
  fatherOrCompanyName: 'Late Hossain Ali',
  ownerMobile: '+8801712345678',
  ownerEmail: 'abulkalam@gmail.com',
  ownerNidTin: '1234567890',
  ownerAddress: 'Madhabpur, Rangpur Sadar, Rangpur',
  ownershipRemarks: 'Long term lease for tea cultivation.',
  usableArea: 118,
  nonUsableArea: 7.5,
  rentAmount: 220000,
  rentPerAcre: 1753.98,
  location: 'Madhabpur, Rangpur Sadar',
  gpsArea: '125.50 Acre',
  latitude: 25.7456,
  longitude: 89.2741,
  purpose: 'Tea cultivation',
  polygon: [
    [25.7474, 89.2719],
    [25.7483, 89.2748],
    [25.7462, 89.2765],
    [25.7434, 89.2754],
    [25.7428, 89.2726],
    [25.7451, 89.2713],
  ],
};

// year, amount, paid, payment date (or null), status, method, reference, remarks
const PAYMENTS: [string, number, number, string | null, string, string, string | null, string][] = [
  ['2015', 150000, 150000, '2015-12-15', 'Paid', 'Bank Transfer', 'REC-2015-001', 'Annual lease payment'],
  ['2016', 150000, 150000, '2016-12-28', 'Paid', 'Bank Transfer', 'REC-2016-001', 'Annual lease payment'],
  ['2017', 165000, 165000, '2017-12-29', 'Paid', 'Cheque', 'CHQ-2017-001', 'Annual lease payment'],
  ['2018', 165000, 165000, '2018-12-30', 'Paid', 'Cheque', 'CHQ-2018-001', 'Annual lease payment'],
  ['2019', 175000, 175000, '2019-12-29', 'Paid', 'Bank Transfer', 'REC-2019-001', 'Annual lease payment'],
  ['2020', 175000, 175000, '2020-12-28', 'Paid', 'Bank Transfer', 'REC-2020-001', 'Annual lease payment'],
  ['2021', 185000, 185000, '2021-12-27', 'Paid', 'Online Payment', 'PAY-2021-001', 'Annual lease payment'],
  ['2022', 185000, 185000, '2022-12-29', 'Paid', 'Bank Transfer', 'REC-2022-001', 'Annual lease payment'],
  ['2023', 195000, 195000, '2023-12-28', 'Paid', 'Bank Transfer', 'REC-2023-001', 'Annual lease payment'],
  ['2024', 195000, 0, null, 'Pending', 'Bank Transfer', null, 'Payment pending'],
  ['2025', 210000, 0, null, 'Overdue', 'Bank Transfer', null, 'Payment overdue'],
  ['2026', 220000, 0, null, 'Pending', 'Bank Transfer', null, 'Current year payment'],
];

// name, type, number, issue, expiry, file name, remarks
const DOCUMENTS: [string, string, string, string, string | null, string, string][] = [
  [
    'Lease Deed',
    'Lease Deed',
    'LD-2024-001',
    '2024-01-01',
    '2043-12-31',
    'lease_deed.pdf',
    'Original lease deed',
  ],
  ['Khatian Copy', 'Khatian', 'KH-1234', '2024-01-10', null, 'khatian_1234.pdf', 'Certified khatian copy'],
  ['CS Record', 'CS Record', 'CS-5678', '2024-01-15', null, 'cs_record.pdf', 'C.S record document'],
  ['Map / Survey Plan', 'Map', 'MAP-2024-001', '2024-01-20', null, 'survey_plan.pdf', 'Latest survey plan'],
  ['NOC', 'NOC', 'NOC-2024-001', '2024-01-25', '2027-01-25', 'noc.pdf', 'No objection certificate'],
  ['SA Record', 'SA Record', 'SA-2024-001', '2024-01-28', null, 'sa_record.pdf', 'S.A record copy'],
  ['RS Record', 'RS Record', 'RS-2024-001', '2024-01-30', null, 'rs_record.pdf', 'R.S record copy'],
  ['BS Record', 'BS Record', 'BS-2024-001', '2024-02-02', null, 'bs_record.pdf', 'B.S record copy'],
];

const day = (v: string) => new Date(`${v}T00:00:00.000Z`);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

/** A placeholder PDF in the upload folder, registered like an upload (RP1-10). */
async function placeholderPdf(db: Database, userId: string, name: string): Promise<string> {
  const id = newId();
  const storageKey = join('seed', `${id}.pdf`);
  await mkdir(join(uploadRoot(), 'seed'), { recursive: true });
  await writeFile(join(uploadRoot(), storageKey), PDF);
  await db.storedFile.create({
    data: { id, name, type: 'application/pdf', size: PDF.length, storageKey, createdBy: userId },
  });
  return id;
}

export async function seedLand(db: Database, userId: string, estates: Record<string, string>) {
  const lands: Record<string, string> = {};
  for (const [
    index,
    [landLeaseName, estateCode, landLeaseType, landCategory, ownerName, totalArea, leaseTerm, landStatus],
  ] of LANDS.entries()) {
    const estate = estates[estateCode];
    if (!estate) continue;
    const leased = leaseTerm !== null;
    const start = 2006 + index;
    lands[landLeaseName] = await seedOne(
      db,
      userId,
      'landRecord',
      { estate, landLeaseName },
      {
        estate,
        landLeaseType,
        landCategory,
        landLeaseName,
        surveyNo: `KH-${1200 + index}`,
        plotNo: `DAG-${340 + index}`,
        mouza: null,
        jlNo: null,
        recordType: null,
        ownerName,
        fatherOrCompanyName: null,
        ownerMobile: null,
        ownerEmail: null,
        ownerNidTin: null,
        ownerAddress: null,
        ownershipRemarks: null,
        totalArea,
        usableArea: null,
        nonUsableArea: null,
        landStatus,
        acquisitionDate: day(`${start}-01-01`),
        startDate: day(`${start}-01-01`),
        endDate: day(leased ? `${start + Number.parseInt(leaseTerm, 10) - 1}-12-31` : '2099-12-31'),
        leaseTerm,
        rentAmount: null,
        rentPerAcre: null,
        location: null,
        gpsArea: null,
        latitude: null,
        longitude: null,
        purpose: null,
        polygon: null,
        ...(index === 0
          ? {
              ...MADHABPUR,
              acquisitionDate: day('2024-01-01'),
              startDate: day('2024-01-01'),
              endDate: day('2043-12-31'),
            }
          : {}),
      },
    );
  }

  const madhabpur = lands['Madhabpur Lease Land'];
  let payments = 0;
  let documents = 0;
  if (madhabpur) {
    for (const [
      year,
      amount,
      paidAmount,
      paymentDate,
      status,
      paymentMethod,
      referenceNo,
      remarks,
    ] of PAYMENTS) {
      await seedOne(
        db,
        userId,
        'landPayment',
        { landLeaseId: madhabpur, year },
        {
          landLeaseId: madhabpur,
          year,
          dueDate: day(`${year}-12-31`),
          amount,
          paidAmount,
          paymentDate: paymentDate ? day(paymentDate) : null,
          status,
          paymentMethod,
          referenceNo,
          remarks,
        },
      );
      payments += 1;
    }
    for (const [
      documentName,
      documentType,
      documentNumber,
      issueDate,
      expiryDate,
      fileName,
      remarks,
    ] of DOCUMENTS) {
      const exists = await db.landDocument.findFirst({
        where: { landLeaseId: madhabpur, documentNumber, deletedAt: null },
      });
      const file = exists ? exists.file : await placeholderPdf(db, userId, fileName);
      await seedOne(
        db,
        userId,
        'landDocument',
        { landLeaseId: madhabpur, documentNumber },
        {
          landLeaseId: madhabpur,
          documentName,
          documentType,
          documentNumber,
          issueDate: day(issueDate),
          expiryDate: expiryDate ? day(expiryDate) : null,
          file,
          remarks,
        },
      );
      documents += 1;
    }
  }
  return { lands: Object.keys(lands).length, payments, documents };
}
