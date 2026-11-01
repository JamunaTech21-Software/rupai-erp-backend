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
import { show } from '../../lib/approval.js';
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
/** RP1-66 Estate Profile List: the Status badge. */
export const ESTATE_STATUSES = ['Active', 'Inactive'] as const;

/** Short Name (JAMUNA): saved in capitals; letters, digits, spaces and hyphens. */
const shortName = () =>
  text(30)
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z0-9][A-Z0-9 -]*$/.test(v), 'Use letters, digits, spaces or hyphens, e.g. JAMUNA');

const estateSchema = z.object({
  // Estate Basic Information
  estateName: text(),
  estateCode: text(),
  shortName: shortName(),
  /** Left empty it is Active. */
  status: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? 'Active' : v),
    oneOf(ESTATE_STATUSES),
  ),
  establishedYear: optInt(),
  companyOwner: optText(),
  estateType: oneOf(ESTATE_TYPES),
  estateCategory: oneOf(ESTATE_CATEGORIES),
  /** The list's "Location (Upazila, District)": required since RP1-66. */
  address: text(5000),
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
  module: 'estate',
  page: 'Estate Profile',
  describe: (r) => show(r.estateCode, `(${String(r.estateName)})`),
  model: 'estate',
  schema: estateSchema,
  search: ['estateName', 'estateCode', 'shortName', 'address', 'companyOwner', 'district'],
  filters: ['estateType', 'estateCategory', 'district', 'status'],
  files: ['estateImages'],
  unique: ['estateCode', 'shortName'],
  children: [{ key: 'managers', model: 'estateManager', parentKey: 'estateId', schema: managerSchema }],
  orderBy: { estateName: 'asc' },
  /** Estate Profile List → Export: the list's columns (Plucking Area is the tea area). */
  export: {
    fileName: 'estates',
    sheet: 'Estates',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Estate Code', value: (row) => row.estateCode, width: 14 },
      { header: 'Estate Name', value: (row) => row.estateName, width: 28 },
      { header: 'Short Name', value: (row) => row.shortName, width: 14 },
      { header: 'Location (Upazila, District)', value: (row) => row.address, width: 34 },
      { header: 'Total Area (Acre)', value: (row) => row.totalLandArea, width: 18, numFmt: '#,##0.00' },
      { header: 'Plucking Area (Acre)', value: (row) => row.teaArea, width: 20, numFmt: '#,##0.00' },
      { header: 'Status', value: (row) => row.status, width: 10 },
    ],
  },
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
