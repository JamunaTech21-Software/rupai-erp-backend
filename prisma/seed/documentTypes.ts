import { type Database } from '../../src/lib/db.js';
import { DEFAULT_TYPE_EXPIRY } from '../../src/modules/documents/expiry.js';
import { seedOne } from './util.js';

/**
 * RP1-142 sample document types: the 8 rows of image 4 (with its reminder / escalation days and Yes / No
 * values) and more so every category has at least one. [category code, type code, name, renewal required,
 * auto status update, reminder days, escalation days]. Added once (by code).
 */
const TYPES: [string, string, string, boolean, boolean, number, number][] = [
  ['REG', 'TL', 'Trade License', true, true, 30, 7],
  ['REG', 'CREG', 'Company Registration Certificate', false, false, 30, 7],
  ['TAX', 'VAT', 'VAT / BIN Certificate', false, false, 30, 7],
  ['TAX', 'TIN', 'TIN Certificate', false, false, 30, 7],
  ['CUS', 'CUS', 'Customs Registration', true, true, 30, 7],
  ['CUS', 'IRC', 'Import Registration Certificate (IRC)', true, true, 30, 7],
  ['CUS', 'ERC', 'Export Registration Certificate (ERC)', true, true, 30, 7],
  ['ENV', 'ECC', 'Environmental Clearance Certificate', true, true, 30, 7],
  ['FIR', 'FSC', 'Fire Safety Certificate', true, true, 30, 7],
  ['FIR', 'FIRL', 'Fire License', true, true, 30, 7],
  ['FAC', 'FL', 'Factory License', true, true, 45, 10],
  ['FAC', 'BOIL', 'Boiler Certificate', true, true, 45, 10],
  ['LAB', 'LABR', 'Labour Registration', true, true, 30, 7],
  ['LAB', 'DIFE', 'DIFE Registration', true, true, 30, 7],
  ['LAN', 'LEASE', 'Lease Agreement', true, true, 60, 7],
  ['LAN', 'DEED', 'Land Deed', false, false, 30, 7],
  ['TEA', 'TBR', 'Tea Board Registration', true, true, 30, 7],
  ['BLD', 'BAPP', 'Building Approval', true, true, 30, 7],
  ['UTL', 'ELEC', 'Electricity Connection', true, true, 30, 7],
  ['INS', 'INSP', 'Insurance Policy', true, true, 30, 7],
  ['FIN', 'BG', 'Bank Guarantee', true, true, 30, 7],
  ['OTH', 'OTHC', 'Other Government Certificate', true, true, 30, 7],
];

export async function seedDocumentTypes(db: Database, userId: string): Promise<number> {
  const categories = await db.documentCategory.findMany({
    where: { deletedAt: null },
    select: { id: true, categoryCode: true },
  });
  const order = new Map<string, number>();
  let added = 0;
  for (const [
    categoryCode,
    typeCode,
    typeName,
    renewalRequired,
    autoStatusUpdate,
    reminder,
    escalation,
  ] of TYPES) {
    const category = categories.find((c) => c.categoryCode === categoryCode);
    if (!category) continue;
    const displayOrder = (order.get(categoryCode) ?? 0) + 1;
    order.set(categoryCode, displayOrder);
    await seedOne(
      db,
      userId,
      'documentType',
      { typeCode },
      {
        ...DEFAULT_TYPE_EXPIRY,
        category: category.id,
        typeCode,
        typeName,
        description: null,
        status: 'ACTIVE',
        displayOrder,
        renewalRequired,
        autoStatusUpdate,
        defaultReminderDays: reminder,
        escalationDays: escalation,
      },
    );
    added += 1;
  }
  return added;
}
