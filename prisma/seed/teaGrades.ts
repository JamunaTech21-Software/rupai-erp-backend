import { type Database } from '../../src/lib/db.js';
import { seedOne } from './util.js';

/**
 * RP1-99 sample grades: the prototype's list (teaGradeData.js). Its "Black Tea" is not on the Tea Type page, so
 * those grades use Orthodox Tea, their category. Its two Custom grades have no standard here, because a grade
 * is Custom when it has none. Added once (by code).
 */
const GRADES = [
  [
    'BOP',
    'Broken Orange Pekoe',
    'ISO 1572',
    '2.00 - 2.80 mm',
    'Well-made broken leaf with mixture of buds. A popular black tea grade.',
  ],
  [
    'BOPF',
    'Broken Orange Pekoe Fannings',
    'ISO 1573',
    '1.50 - 2.00 mm',
    'Fine broken leaf grade suitable for producing a strong and bright liquor.',
  ],
  [
    'BP',
    'Broken Pekoe',
    'ISO 1574',
    '2.00 - 3.00 mm',
    'Broken pekoe leaf grade with good strength and balanced character.',
  ],
  [
    'PF',
    'Pekoe Fannings',
    'ISO 1576',
    '1.00 - 1.50 mm',
    'Small pekoe leaf particles producing a brisk and bright infusion.',
  ],
  [
    'PD',
    'Pekoe Dust',
    'ISO 1577',
    '0.50 - 1.00 mm',
    'Fine pekoe particles used for producing strong and quick brewing tea.',
  ],
  [
    'DUST',
    'Dust',
    'ISO 1578',
    'Below 0.50 mm',
    'Very fine tea particles providing fast infusion and strong liquor.',
  ],
  [
    'OPA',
    'Orange Pekoe A',
    'ISO 1571',
    '3.00 - 4.00 mm',
    'Large whole leaf grade with delicate character and good appearance.',
  ],
  [
    'OP',
    'Orange Pekoe',
    'ISO 1570',
    '3.00 - 4.50 mm',
    'Whole leaf black tea grade with good appearance and balanced flavor.',
  ],
  [
    'P',
    'Pekoe',
    'ISO 1569',
    '2.50 - 3.50 mm',
    'Medium whole leaf tea grade with smooth and balanced character.',
  ],
  [
    'TGFO P',
    'Tippy Golden Flowery Orange Pekoe',
    'ISO 1610',
    '3.00 - 4.00 mm',
    'Premium whole leaf grade containing golden tips and high-quality leaves.',
  ],
  [
    'CTC-DUST',
    'CTC Dust',
    null,
    'Below 0.50 mm',
    'Fine CTC tea particle designed for quick infusion and strong liquor.',
  ],
  [
    'CTC-LEAF',
    'CTC Leaf',
    null,
    '2.00 - 3.00 mm',
    'CTC processed leaf grade with strong liquor and consistent appearance.',
  ],
] as const;

export async function seedTeaGrades(db: Database, userId: string): Promise<number> {
  const types = await db.teaType.findMany({
    where: { teaTypeCode: { in: ['ORTH', 'CTC'] }, deletedAt: null },
    select: { id: true, teaTypeCode: true },
  });
  const typeId = (code: string) => {
    const found = types.find((t) => t.teaTypeCode === code);
    if (!found) throw new Error(`Tea type ${code} is missing`);
    return found.id;
  };
  for (const [gradeCode, gradeName, standard, gradeSize, description] of GRADES) {
    const ctc = gradeCode.startsWith('CTC');
    await seedOne(
      db,
      userId,
      'teaGrade',
      { gradeCode },
      {
        gradeCode,
        gradeName,
        teaType: typeId(ctc ? 'CTC' : 'ORTH'),
        category: ctc ? 'CTC' : 'Orthodox',
        standard,
        gradeSize,
        status: 'Active',
        description,
        remarks: null,
      },
    );
  }
  return GRADES.length;
}
