import { type Database } from '../../src/lib/db.js';
import { monthsBetween } from '../../src/modules/documents/documents.js';
import { expiringFromOf, windowDays } from '../../src/modules/documents/status.js';
import { placeholderPdf, seedOne } from './util.js';

/**
 * RP1-148 sample documents: image 1's expiring and recent documents and more across the categories. Expiry
 * dates count from the seed day (days ahead, negative = already expired; null = no expiry), so a fresh database
 * shows expiring and expired documents. [type code, document no., name, issuing authority, days to expiry,
 * validity months]. Added once (by document no.).
 */
const DOCUMENTS: [string, string, string, string, number | null, number][] = [
  ['ECC', 'ECC-2024-001', 'Environmental Clearance Certificate', 'Department of Environment (DoE)', 12, 24],
  ['FSC', 'FSC-2025-014', 'Fire Safety Certificate', 'Fire Service and Civil Defence', 28, 12],
  ['TL', 'TL-2026-009', 'Trade License', 'Sreemangal Pourashava', 38, 12],
  ['FL', 'FL-2024-006', 'Factory License', 'DIFE, Ministry of Labour', 53, 24],
  ['CUS', 'CUS-2025-018', 'Customs Registration', 'National Board of Revenue (Customs)', 65, 12],
  ['LABR', 'LABR-2025-003', 'Labour Registration', 'Department of Labour', -15, 12],
  ['ELEC', 'ELEC-2023-011', 'Electricity Connection Permit', 'Palli Bidyut Samity', -45, 36],
  ['VAT', 'VAT-BIN-2026-001', 'VAT / BIN Certificate', 'National Board of Revenue (VAT)', null, 0],
  ['TIN', 'TIN-2019-001', 'TIN Certificate', 'National Board of Revenue (Tax)', null, 0],
  ['CREG', 'RJSC-2010-145', 'Company Registration Certificate', 'RJSC', null, 0],
  ['LEASE', 'LSE-014', 'Lease Agreement (LSE-014)', 'Ministry of Land', 600, 60],
  ['BOIL', 'BOIL-2026-002', 'Boiler Certificate', 'Office of the Chief Inspector of Boilers', 120, 12],
  ['INSP', 'INS-2026-021', 'Insurance Policy (Factory)', 'Green Delta Insurance', 180, 12],
  ['TBR', 'TBR-2026-007', 'Tea Board Registration', 'Bangladesh Tea Board', 330, 12],
  ['IRC', 'IRC-2025-044', 'Import Registration Certificate (IRC)', 'CCI&E', 200, 12],
  ['ERC', 'ERC-2025-031', 'Export Registration Certificate (ERC)', 'CCI&E', 250, 12],
  ['FIRL', 'FIRL-2026-005', 'Fire License', 'Fire Service and Civil Defence', 300, 12],
  ['DIFE', 'DIFE-2025-112', 'DIFE Registration', 'DIFE, Ministry of Labour', 400, 24],
  ['DEED', 'DEED-1998-077', 'Land Deed (Rupganj Mouza)', 'Sub-Registry Office', null, 0],
  ['BAPP', 'BAPP-2025-009', 'Building Approval (Factory Shed)', 'Upazila Engineering Office', 500, 36],
  ['BG', 'BG-2026-015', 'Bank Guarantee (Auction)', 'Sonali Bank PLC', 150, 12],
  ['OTHC', 'OTH-2026-002', 'Environmental Audit Report', 'Department of Environment (DoE)', 90, 12],
];

const DAY = 86_400_000;
const today = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};
const addMonths = (d: Date, months: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));

export async function seedDocuments(db: Database, userId: string): Promise<number> {
  const types = await db.documentType.findMany({
    where: { deletedAt: null },
    select: { id: true, typeCode: true, category: true, reminders: true, defaultReminderDays: true },
  });
  let added = 0;
  for (const [typeCode, documentNo, documentName, issuingAuthority, daysLeft, validity] of DOCUMENTS) {
    const type = types.find((t) => t.typeCode === typeCode);
    if (!type) continue;
    if (await db.document.count({ where: { documentNo, deletedAt: null } })) {
      added += 1;
      continue;
    }
    const expiryDate = daysLeft === null ? null : new Date(today().getTime() + daysLeft * DAY);
    const issueDate = expiryDate ? addMonths(expiryDate, -validity) : new Date(Date.UTC(2019, 6, 1));
    await seedOne(
      db,
      userId,
      'document',
      { documentNo },
      {
        category: type.category,
        type: type.id,
        documentName,
        documentNo,
        issuingAuthority,
        issueDate,
        expiryDate,
        validityMonths: expiryDate ? monthsBetween(issueDate, expiryDate) : null,
        renewalRequired: expiryDate !== null,
        reminderSetting: 'DEFAULT',
        reminderDays: null,
        attachment: await placeholderPdf(db, userId, `${documentNo}.pdf`),
        remarks: null,
        isActive: true,
        expiringFrom: expiringFromOf(
          expiryDate,
          windowDays({ reminderSetting: 'DEFAULT', reminderDays: null }, type),
        ),
      },
    );
    added += 1;
  }
  return added;
}
