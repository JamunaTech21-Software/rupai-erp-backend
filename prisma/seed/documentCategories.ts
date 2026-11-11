import { type Database } from '../../src/lib/db.js';
import { seedOne } from './util.js';

/** RP1-139 sample document categories: the 14 rows of the Document Category design (image 3). Added once (by code). */
const CATEGORIES = [
  ['REG', 'Business & Registration', 'Trade License, Company Registration, Business Registration'],
  ['TAX', 'Tax & VAT', 'VAT/BIN Certificate, TIN Certificate, Tax-related Documents'],
  ['CUS', 'Customs & Import/Export', 'Customs Registration, IRC, ERC, Import/Export Permits'],
  ['ENV', 'Environmental Compliance', 'Environmental Clearance Certificate, Environmental Permits'],
  ['FIR', 'Fire & Safety', 'Fire License, Fire Safety Certificate, Fire NOC'],
  ['FAC', 'Factory & Industrial', 'Factory License, Boiler Certificate, Industrial Permits'],
  ['LAB', 'Labour & Employment', 'DIFE Registration, Labour License, Workforce Compliance'],
  ['LAN', 'Land & Property', 'Land Deed, Lease Agreement, Mutation, Land Lease Documents'],
  ['TEA', 'Tea Industry & Regulatory', 'Tea Board Registration, Tea Industry Licenses, Related Permits'],
  ['BLD', 'Building & Construction', 'Building Approval, Construction Permit, Building NOC'],
  ['UTL', 'Utility & Services', 'Electricity, Gas, Water Connection, Utility Permits'],
  ['INS', 'Insurance', 'Factory Insurance, Building Insurance, Asset Insurance'],
  ['FIN', 'Financial & Banking', 'Bank Guarantee, Loan Documents, Financial Certificates'],
  ['OTH', 'Other Documents', 'Other Government Certificates or Estate-specific Documents'],
] as const;

export async function seedDocumentCategories(db: Database, userId: string): Promise<number> {
  for (const [i, [categoryCode, categoryName, description]] of CATEGORIES.entries())
    await seedOne(
      db,
      userId,
      'documentCategory',
      { categoryCode },
      { categoryCode, categoryName, description, status: 'ACTIVE', displayOrder: i + 1 },
    );
  return CATEGORIES.length;
}
