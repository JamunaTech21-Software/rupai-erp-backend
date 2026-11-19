import { type Database } from '../../src/lib/db.js';
import { seedOne } from './util.js';

/**
 * RP1-99 sample grades: the prototype's list (teaGradeData.js). Its "Black Tea" grades are Orthodox. RP1-208: no
 * code, size or description; fixed Tea Type and Category (Dust grades are Dust, the rest Leaf). RP1-211: no
 * standard. Added once (by name).
 */
const GRADES = [
  ['Broken Orange Pekoe', 'Orthodox', 'Leaf'],
  ['Broken Orange Pekoe Fannings', 'Orthodox', 'Leaf'],
  ['Broken Pekoe', 'Orthodox', 'Leaf'],
  ['Pekoe Fannings', 'Orthodox', 'Leaf'],
  ['Pekoe Dust', 'Orthodox', 'Dust'],
  ['Dust', 'Orthodox', 'Dust'],
  ['Orange Pekoe A', 'Orthodox', 'Leaf'],
  ['Orange Pekoe', 'Orthodox', 'Leaf'],
  ['Pekoe', 'Orthodox', 'Leaf'],
  ['Tippy Golden Flowery Orange Pekoe', 'Orthodox', 'Leaf'],
  ['CTC Dust', 'CTC', 'Dust'],
  ['CTC Leaf', 'CTC', 'Leaf'],
] as const;

export async function seedTeaGrades(db: Database, userId: string): Promise<number> {
  for (const [gradeName, teaType, category] of GRADES)
    await seedOne(
      db,
      userId,
      'teaGrade',
      { gradeName },
      { gradeName, teaType, category, status: 'Active', remarks: null },
    );
  return GRADES.length;
}
