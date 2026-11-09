import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { oneOf, optDate, optEmail, optOneOf, optText, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-105 K.5 Auction Centers: `AuctionCenters.jsx`, built from `auctionCentersData.js`, so the keys are its
 * field `name`s and the values its option `value`s. The phone stays free text, as on the page: the sample
 * numbers are landlines such as +880 31 251 0501.
 */
const CITIES = [
  { value: 'chattogram', label: 'Chattogram' },
  { value: 'sreemangal', label: 'Sreemangal' },
  { value: 'panchagarh', label: 'Panchagarh' },
  { value: 'sylhet', label: 'Sylhet' },
];
const DIVISIONS = [
  { value: 'chattogram', label: 'Chattogram' },
  { value: 'sylhet', label: 'Sylhet' },
  { value: 'rangpur', label: 'Rangpur' },
  { value: 'dhaka', label: 'Dhaka' },
];
const DAYS = [
  { value: 'sunday', label: 'Sunday' },
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
];
const TIME_ZONES = [{ value: 'gmt6', label: '(GMT+06:00) Dhaka' }];
const CURRENCIES = [
  { value: 'bdt', label: 'BDT (Bangladeshi Taka)' },
  { value: 'usd', label: 'USD (US Dollar)' },
];
const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];
const MANAGED_BY = [
  { value: 'ttab', label: 'Tea Traders Association of Bangladesh (TTAB)' },
  { value: 'small-tea-garden', label: 'Small Tea Garden Owners & Tea Traders Association of Bangladesh' },
];
const REGULATORS = [{ value: 'bangladesh-tea-board', label: 'Bangladesh Tea Board' }];

type Option = { value: string; label: string };
const valuesOf = (list: Option[]) => list.map((o) => o.value);
const labelOf = (list: Option[], value: unknown) => list.find((o) => o.value === value)?.label ?? null;

const pickDay = 'Select at least one day.';
const centerSchema = z.object({
  centerCode: text(40),
  centerName: text(160),
  shortName: optText(50),
  address: text(500),
  cityDistrict: oneOf(valuesOf(CITIES)),
  division: oneOf(valuesOf(DIVISIONS)),
  contactPerson: optText(120),
  phone: text(30),
  email: optEmail(),
  auctionDays: z
    .array(oneOf(valuesOf(DAYS)), { error: pickDay })
    .min(1, pickDay)
    .transform((v) => valuesOf(DAYS).filter((day) => v.includes(day))),
  auctionStartTime: text(5).regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use the format HH:MM.'),
  timeZone: optOneOf(valuesOf(TIME_ZONES)),
  currency: optOneOf(valuesOf(CURRENCIES)),
  status: oneOf(valuesOf(STATUSES)),
  managedBy: oneOf(valuesOf(MANAGED_BY)),
  regulatoryAuthority: oneOf(valuesOf(REGULATORS)),
  establishedOn: optDate(),
  remarks: optText(500),
});

/** `14:05` → `02:05 PM`, as the summary shows it. */
function clock(value: unknown) {
  if (typeof value !== 'string' || !value.includes(':')) return null;
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  const hour = String(hours % 12 || 12).padStart(2, '0');
  return `${hour}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

export const auctionCentersRouter = defineResource('/auction-centers', {
  name: 'auctionCenter',
  label: 'Auction center',
  module: 'master',
  page: 'Auction Centers',
  describe: (r) => show(r.centerCode, paren(r.centerName)),
  model: 'auctionCenter',
  schema: centerSchema,
  search: ['centerCode', 'centerName', 'shortName', 'contactPerson'],
  filters: ['cityDistrict', 'division', 'managedBy', 'status'],
  unique: ['centerCode'],
  orderBy: [{ centerCode: 'asc' }],
  extend: (row) => {
    const days = Array.isArray(row.auctionDays) ? row.auctionDays : [];
    return {
      cityDistrictLabel: labelOf(CITIES, row.cityDistrict),
      divisionLabel: labelOf(DIVISIONS, row.division),
      auctionDaysLabel: days.map((d) => labelOf(DAYS, d)).join(', '),
      auctionStartTimeLabel: clock(row.auctionStartTime),
      timeZoneLabel: labelOf(TIME_ZONES, row.timeZone),
      currencyLabel: labelOf(CURRENCIES, row.currency),
      statusLabel: labelOf(STATUSES, row.status),
      managedByLabel: labelOf(MANAGED_BY, row.managedBy),
      regulatoryAuthorityLabel: labelOf(REGULATORS, row.regulatoryAuthority),
    };
  },
  export: {
    fileName: 'auction-centers',
    sheet: 'Auction Centers',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Code', value: (row) => row.centerCode, width: 12 },
      { header: 'Center Name', value: (row) => row.centerName, width: 36 },
      { header: 'City', value: (row) => row.cityDistrictLabel, width: 16 },
      { header: 'Managed By', value: (row) => row.managedByLabel, width: 44 },
      { header: 'Regulatory Authority', value: (row) => row.regulatoryAuthorityLabel, width: 24 },
      { header: 'Auction Days', value: (row) => row.auctionDaysLabel, width: 30 },
      { header: 'Auction Start', value: (row) => row.auctionStartTimeLabel, width: 14 },
      { header: 'Status', value: (row) => row.statusLabel, width: 10 },
    ],
  },
  // RP1-108: a center stays while an auction schedule row uses it.
  deleteCheck: async (row) => {
    const used = await db.auctionSchedule.count({ where: { auctionCenter: row.id, deletedAt: null } });
    return used
      ? `This auction center is used by ${used} auction schedule row${used === 1 ? '' : 's'}.`
      : undefined;
  },
  options: { path: 'auction-centers', label: (row) => String(row.centerName), filters: ['status'] },
});

/** The form's dropdowns and the list's filters. */
export const auctionCenterExtrasRouter = Router();
auctionCenterExtrasRouter.get('/filter-options', (_req, res) => {
  const numbered = (list: Option[]) => list.map((o, i) => ({ id: i + 1, ...o }));
  res.json({
    cities: numbered(CITIES),
    divisions: numbered(DIVISIONS),
    auctionDays: numbered(DAYS),
    timeZones: numbered(TIME_ZONES),
    currencies: numbered(CURRENCIES),
    statuses: numbered(STATUSES),
    managedBy: numbered(MANAGED_BY),
    regulatoryAuthorities: numbered(REGULATORS),
  });
});
docsPaths['/auction-centers/filter-options'] = {
  get: {
    tags: ['Auction center'],
    summary:
      'Auction Centers form and filter options: cities, divisions, auctionDays, timeZones, currencies, statuses, managedBy, regulatoryAuthorities',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
