import { type Database } from '../../src/lib/db.js';
import { seedOne } from './util.js';

/**
 * RP1-13 sample divisions and sections: the prototype's `divisionList` and `sectionList` for Jamuna Tea
 * Estate. The prototype's section codes (SEC-A…) do not pass its own form rule (`SEC-<number>`), so they
 * become SEC-001…; names, areas, managers and status are the prototype's. Tetulia gets two divisions to
 * show that codes repeat per estate.
 */
const JTE_DIVISIONS = [
  ['Rangpur Division', 'DIV-01', 1250, 8, 'Active'],
  ['Uttara Division', 'DIV-02', 980.5, 6, 'Active'],
  ['Dakshin Division', 'DIV-03', 1120.75, 7, 'Active'],
  ['Purba Division', 'DIV-04', 860.25, 5, 'Inactive'],
  ['Paschim Division', 'DIV-05', 1045, 6, 'Active'],
] as const;

const DIV01_SECTIONS = [
  ['Section A', 180, 'Md. Faruk Hossain', 'Active'],
  ['Section B', 165.5, 'Md. Jalal Uddin', 'Active'],
  ['Section C', 210.75, 'Md. Kamrul Hasan', 'Active'],
  ['Section D', 175, 'Md. Rezaul Karim', 'Inactive'],
  ['Section E', 190, 'Md. Abul Bashar', 'Active'],
  ['Section F', 220.25, 'Md. Monir Hossain', 'Active'],
  ['Section G', 160, 'Md. Nazrul Islam', 'Active'],
  ['Section H', 210.5, 'Md. Shahidul Islam', 'Active'],
] as const;

const TGE_DIVISIONS = [
  ['North Division', 'DIV-01', 720, 2, 'Active'],
  ['South Division', 'DIV-02', 700, 2, 'Active'],
] as const;

/** Returns division ids by `<estate code>/<division code>` and section ids by `<division key>/<section code>`. */
export async function seedDivisions(db: Database, userId: string, estates: Record<string, string>) {
  const divisions: Record<string, string> = {};
  const sections: Record<string, string> = {};
  const addDivisions = async (estateCode: string, rows: typeof JTE_DIVISIONS | typeof TGE_DIVISIONS) => {
    const estate = estates[estateCode];
    if (!estate) return;
    for (const [divisionName, divisionCode, totalArea, totalSection, status] of rows)
      divisions[`${estateCode}/${divisionCode}`] = await seedOne(
        db,
        userId,
        'division',
        { estate, divisionCode },
        { estate, divisionName, divisionCode, totalArea, totalSection, status, description: null },
      );
  };
  await addDivisions('JTE-001', JTE_DIVISIONS);
  await addDivisions('TGE-002', TGE_DIVISIONS);

  const div01 = divisions['JTE-001/DIV-01'];
  if (div01)
    for (const [index, [sectionName, totalArea, manager, status]] of DIV01_SECTIONS.entries()) {
      const sectionCode = `SEC-${String(index + 1).padStart(3, '0')}`;
      sections[`JTE-001/DIV-01/${sectionCode}`] = await seedOne(
        db,
        userId,
        'section',
        { division: div01, sectionCode },
        { division: div01, parentSection: null, sectionName, sectionCode, totalArea, manager, status },
      );
    }
  // One sub-section, so "Parent Section" has an example.
  const parent = sections['JTE-001/DIV-01/SEC-001'];
  if (div01 && parent)
    sections['JTE-001/DIV-01/SEC-009'] = await seedOne(
      db,
      userId,
      'section',
      { division: div01, sectionCode: 'SEC-009' },
      {
        division: div01,
        parentSection: parent,
        sectionName: 'Section A-1',
        sectionCode: 'SEC-009',
        totalArea: 45,
        manager: 'Md. Faruk Hossain',
        status: 'Active',
      },
    );
  return { divisions, sections };
}
