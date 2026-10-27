import { db } from '../../lib/db.js';
import {
  bool,
  list,
  longText,
  num,
  optDate,
  optInt,
  optNum,
  optOption,
  optText,
  option,
  ref,
  reqDate,
} from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { checkLocation } from '../estate/location.js';
import { plantationSummary } from './nurseries.js';

/**
 * RP1-18 B.2 Field Planting: `FieldPlanting.jsx`. Keys are the form's `register(...)` names. Its selects
 * hard-code values that differ from `fieldPlantingData.dropdownOptions` (e.g. `spring` vs "Spring (Feb -
 * Mar)"), so select fields accept the text the page sends. The history table is the list.
 */
const plantingSchema = z.object({
  // Planting Information
  estate: ref(),
  division: ref(),
  section: ref(),
  fieldBlock: ref(),
  plantingYear: num()
    .refine((v) => Number.isInteger(v), 'Must be a whole number.')
    .refine((v) => v >= 1900 && v <= 2100, 'Enter a valid year'),
  plantingSeason: option(),
  plantingDate: reqDate(),
  plantingMethod: option(),
  plantSource: option(),
  nurseryBed: optText(100),
  cloneVariety: option(),
  plantType: option(),
  totalArea: optNum(),
  netPlantableArea: optNum(),
  previousCrop: optText(100),
  rowSpacing: optNum(),
  plantSpacing: optNum(),
  pitSize: optText(60),
  expectedPlants: optInt(),
  targetPlants: optInt(),
  signalPlant: optInt(),
  // Soil & Site
  soilType: option(),
  soilPH: optNum().refine((v) => v === null || v <= 14, 'pH is between 0 and 14.'),
  elevation: optNum(),
  slope: optOption(),
  drainage: optOption(),
  irrigationSource: optOption(),
  irrigationMethod: optOption(),
  basalFertilizer: optText(100),
  organicManure: optText(100),
  shadeTreePlanned: bool(),
  // Fertilizer Schedule
  npkAmount: optNum(),
  npkUnit: optOption(),
  tspAmount: optNum(),
  tspUnit: optOption(),
  mopAmount: optNum(),
  mopUnit: optOption(),
  fymAmount: optNum(),
  fymUnit: optOption(),
  // Shade Tree
  shadeTreeSpecies: optText(100),
  shadeTreeSpacing: optText(60),
  shadeTreeCount: optInt(),
  shadePurpose: optText(100),
  shadePlantingDate: optDate(),
  shadeRemarks: longText(),
  // Field Officer & Labour
  fieldOfficer: optOption(),
  assistantSupervisor: optOption(),
  totalLabour: optInt(),
  maleLabour: optInt(),
  femaleLabour: optInt(),
  labourSource: optOption(),
  remarks: longText(),
  // Uploads: file ids from POST /files
  documents: list(),
  photos: list(),
});

/** Estate → division → section → field must belong together. */
async function check(values: Record<string, unknown>): Promise<Record<string, string>> {
  const fields = await checkLocation(values);
  if (
    values.netPlantableArea !== null &&
    values.totalArea !== null &&
    Number(values.netPlantableArea) > Number(values.totalArea)
  )
    fields.netPlantableArea = 'Net plantable area cannot be more than the total area.';
  const labour = Number(values.maleLabour ?? 0) + Number(values.femaleLabour ?? 0);
  if (values.totalLabour !== null && labour > Number(values.totalLabour))
    fields.totalLabour = 'Male and female labour together are more than the total labour.';
  return fields;
}

const FERTILIZERS = [
  ['npk', 'NPK (15:15:15)'],
  ['tsp', 'TSP'],
  ['mop', 'MOP'],
  ['fym', 'FYM'],
] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

export const plantingsRouter = defineResource('/field-plantings', {
  name: 'fieldPlanting',
  label: 'Field planting',
  model: 'fieldPlanting',
  schema: plantingSchema,
  search: ['cloneVariety', 'plantingMethod', 'plantingSeason', 'remarks'],
  filters: [
    'estate',
    'division',
    'section',
    'fieldBlock',
    'cloneVariety',
    'plantingMethod',
    { name: 'plantingYear', where: (year) => ({ plantingYear: Number.parseInt(year, 10) || 0 }) },
  ],
  refs: {
    estate: { model: 'estate', label: 'estateName' },
    division: { model: 'division', label: 'divisionName' },
    section: { model: 'section', label: 'sectionName' },
    fieldBlock: { model: 'fieldBlock', label: 'fieldCode' },
  },
  files: ['documents', 'photos'],
  check,
  orderBy: [{ plantingYear: 'desc' }, { plantingDate: 'desc' }],
  /**
   * Per record: `fertilizerSchedule` (from the four fertilizer rows) and the progress the history table
   * and the Planting Progress card show. Progress comes from `plantedPlants` against `expectedPlants`.
   */
  extend: (row) => {
    const expected = Number(row.expectedPlants ?? 0);
    const planted = Number(row.plantedPlants ?? 0);
    const completion = expected ? Math.min(100, Math.round((planted / expected) * 100)) : 0;
    const area = Number(row.netPlantableArea ?? row.totalArea ?? 0);
    const areaCompleted = round2((area * completion) / 100);
    return {
      fertilizerSchedule: FERTILIZERS.filter(([key]) => row[`${key}Amount`] !== null).map(
        ([key, fertilizer], i) => ({
          id: i + 1,
          fertilizer,
          amount: row[`${key}Amount`],
          unit: row[`${key}Unit`],
        }),
      ),
      completion,
      plantingStatus: completion >= 100 ? 'Completed' : planted > 0 ? 'In Progress' : 'Planned',
      plantingProgress: {
        percentage: completion,
        areaCompleted,
        plantsPlanted: planted,
        remainingArea: round2(Math.max(0, area - areaCompleted)),
        remainingPlants: Math.max(0, expected - planted),
      },
    };
  },
  /** The Plantation Summary card, plus totals over the plantings in the filter. */
  summary: async (where) => {
    const [plantation, totals] = await Promise.all([
      plantationSummary(typeof where.estate === 'string' ? where.estate : undefined),
      db.fieldPlanting.aggregate({
        where,
        _count: { _all: true },
        _sum: { totalArea: true, expectedPlants: true, targetPlants: true, plantedPlants: true },
      }),
    ]);
    const expected = Number(totals._sum.expectedPlants ?? 0);
    const planted = Number(totals._sum.plantedPlants ?? 0);
    return {
      plantationSummary: plantation,
      plantings: {
        totalPlantings: totals._count._all,
        totalArea: Number(totals._sum.totalArea ?? 0),
        expectedPlants: expected,
        targetPlants: Number(totals._sum.targetPlants ?? 0),
        plantsPlanted: planted,
        completion: expected ? Math.min(100, Math.round((planted / expected) * 100)) : 0,
      },
    };
  },
});
