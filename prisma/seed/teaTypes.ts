import { type Database } from '../../src/lib/db.js';
import { seedOne } from './util.js';

/** RP1-96 sample tea types: the prototype's Tea Type List (teaTypeData.js). Added once (by code). */
const TEA_TYPES = [
  ['CTC', 'CTC Tea', 'CTC', 'CTC (Crush, Tear, Curl) processed tea.'],
  ['ORTH', 'Orthodox Tea', 'ORTHODOX', 'Traditionally processed orthodox tea.'],
  ['GREEN', 'Green Tea', 'GREEN', 'Green tea processed with minimal oxidation.'],
  ['WHITE', 'White Tea', 'WHITE', 'Delicately processed white tea.'],
  ['OOLONG', 'Oolong Tea', 'OOLONG', 'Partially oxidized oolong tea.'],
  ['OTHER', 'Other', 'OTHER', 'Other tea types and processing methods.'],
] as const;

export async function seedTeaTypes(db: Database, userId: string): Promise<number> {
  for (const [teaTypeCode, teaTypeName, processingMethod, description] of TEA_TYPES)
    await seedOne(
      db,
      userId,
      'teaType',
      { teaTypeCode },
      {
        teaTypeCode,
        teaTypeName,
        shortName: teaTypeCode,
        processingMethod,
        description,
        applicableFor: ['PRODUCTION', 'AUCTION_SALE'],
        status: 'ACTIVE',
        remarks: null,
      },
    );
  return TEA_TYPES.length;
}
