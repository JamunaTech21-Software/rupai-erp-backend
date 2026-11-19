import { type Database } from '../../src/lib/db.js';
import { seedOne } from './util.js';

/**
 * RP1-99 sample grades: the prototype's list (teaGradeData.js). Its "Black Tea" grades are Orthodox. Its two
 * Custom grades have no standard here, because a grade is Custom when it has none. RP1-208: no code, size or
 * description; fixed Tea Type and Category (Dust grades are Dust, the rest Leaf). Added once (by name).
 */
const GRADES = [
  ['Broken Orange Pekoe', 'Orthodox', 'Leaf', 'ISO 1572'],
  ['Broken Orange Pekoe Fannings', 'Orthodox', 'Leaf', 'ISO 1573'],
  ['Broken Pekoe', 'Orthodox', 'Leaf', 'ISO 1574'],
  ['Pekoe Fannings', 'Orthodox', 'Leaf', 'ISO 1576'],
  ['Pekoe Dust', 'Orthodox', 'Dust', 'ISO 1577'],
  ['Dust', 'Orthodox', 'Dust', 'ISO 1578'],
  ['Orange Pekoe A', 'Orthodox', 'Leaf', 'ISO 1571'],
  ['Orange Pekoe', 'Orthodox', 'Leaf', 'ISO 1570'],
  ['Pekoe', 'Orthodox', 'Leaf', 'ISO 1569'],
  ['Tippy Golden Flowery Orange Pekoe', 'Orthodox', 'Leaf', 'ISO 1610'],
  ['CTC Dust', 'CTC', 'Dust', null],
  ['CTC Leaf', 'CTC', 'Leaf', null],
] as const;

export async function seedTeaGrades(db: Database, userId: string): Promise<number> {
  for (const [gradeName, teaType, category, standard] of GRADES)
    await seedOne(
      db,
      userId,
      'teaGrade',
      { gradeName },
      { gradeName, teaType, category, standard, status: 'Active', remarks: null },
    );
  return GRADES.length;
}
