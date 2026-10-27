import { db } from '../../lib/db.js';
import {
  coord,
  list,
  longText,
  num,
  optEmail,
  optInt,
  optNum,
  optPhone,
  optText,
  optUrl,
  oneOf,
  text,
} from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-12 A.1 Estate Profile: `EstateProfile.jsx`. Keys are the page's `register(...)` names; options are
 * the `value`s in `estateProfileData.js`.
 */
export const ESTATE_TYPES = ['company_owned', 'private_estate', 'government_estate'] as const;
export const ESTATE_CATEGORIES = ['large_estate', 'medium_estate', 'small_estate'] as const;
export const FACILITIES = [
  'factory',
  'warehouse',
  'staff_quarter',
  'hospital',
  'school',
  'playground',
  'religious_place',
  'electricity',
  'water_supply',
  'transport',
  'canteen',
  'club_library',
] as const;
export const MANAGER_TYPES = ['estate_manager', 'assistant_manager'] as const;

const estateSchema = z.object({
  // Estate Basic Information
  estateName: text(),
  estateCode: text(),
  establishedYear: optInt(),
  companyOwner: optText(),
  estateType: oneOf(ESTATE_TYPES),
  estateCategory: oneOf(ESTATE_CATEGORIES),
  address: longText(),
  policeStation: optText(),
  district: optText(),
  division: optText(),
  country: optText(),
  zipCode: optText(),
  phone: optPhone(),
  email: optEmail(),
  website: optUrl(),
  // Estate Overview
  totalLandArea: num(),
  teaArea: num(),
  nonTeaArea: optNum(),
  totalFieldBlock: optInt(),
  totalDivision: optInt(),
  totalSection: optInt(),
  totalWorker: optInt(),
  totalFamily: optInt(),
  // Facilities / Amenities
  selectedFacilities: list().pipe(
    z.array(z.string()).refine((v) => v.every((f) => (FACILITIES as readonly string[]).includes(f)), {
      message: 'Select facilities from the list.',
    }),
  ),
  otherFacilityName: optText(),
  // Estate Images: uploaded file ids (POST /files)
  estateImages: list(),
  // Geo Location
  latitude: coord(90),
  longitude: coord(180),
  // Description / Note
  description: longText(),
});

/** Manager / In-charge Information: one row per block (`managerInformation`). */
const managerSchema = z.object({
  type: oneOf(MANAGER_TYPES),
  name: optText(),
  mobile: optText(20),
  email: optEmail(),
});

const OVERVIEW = [
  'totalLandArea',
  'teaArea',
  'nonTeaArea',
  'totalFieldBlock',
  'totalDivision',
  'totalSection',
  'totalWorker',
  'totalFamily',
] as const;

export const estatesRouter = defineResource('/estates', {
  name: 'estate',
  label: 'Estate',
  model: 'estate',
  schema: estateSchema,
  search: ['estateName', 'estateCode', 'companyOwner', 'district'],
  filters: ['estateType', 'estateCategory', 'district'],
  files: ['estateImages'],
  unique: ['estateCode'],
  children: [{ key: 'managers', model: 'estateManager', parentKey: 'estateId', schema: managerSchema }],
  orderBy: { estateName: 'asc' },
  /** The "Estate Summary" panel (`estateOverview` keys), added up over the estates in the list's filter. */
  summary: async (where) => {
    const totals = await db.estate.aggregate({
      where,
      _count: { _all: true },
      _sum: Object.fromEntries(OVERVIEW.map((k) => [k, true])) as Record<(typeof OVERVIEW)[number], true>,
    });
    return {
      totalEstate: totals._count._all,
      ...Object.fromEntries(OVERVIEW.map((k) => [k, totals._sum[k] ?? 0])),
    };
  },
  options: { path: 'estates', label: (row) => `${String(row.estateName)} (${String(row.estateCode)})` },
});
