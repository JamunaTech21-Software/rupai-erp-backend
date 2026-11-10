import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { bool, num, oneOf, optEmail, optOneOf, optText, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { positionsOfBroker } from './brokerSalePositions.js';

/**
 * RP1-111 K.7 Add New Broker: `AddNewBroker.jsx`, built from `addBrokerData.js`, so the keys are its field
 * `name`s and the values its option `code`s. The page's `associationId`, and a mobile row's `designationId` and
 * `typeCode`, are sent as `association`, `designation` and `type`, the keys of the data file's rows. Auction
 * Center(s) are the saved centers' ids. The prototype has no list, so the Broker List is added.
 */
const DESIGNATIONS = [
  { value: 'PROPRIETOR', label: 'Proprietor' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ACCOUNTS_OFFICER', label: 'Accounts Officer' },
  { value: 'MARKETING_EXECUTIVE', label: 'Marketing Executive' },
];
const MOBILE_TYPES = [
  { value: 'PRIMARY', label: 'Primary' },
  { value: 'SECONDARY', label: 'Secondary' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'OTHER', label: 'Other' },
];
const ASSOCIATIONS = [
  { value: 'TTAB', label: 'Tea Traders Association of Bangladesh (TTAB)' },
  { value: 'OTHER', label: 'Other Association' },
];
const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

type Option = { value: string; label: string };
const valuesOf = (list: Option[]) => list.map((o) => o.value);
const labelOf = (list: Option[], value: unknown) => list.find((o) => o.value === value)?.label ?? null;

/** The prototype writes numbers as 01711-123456, so spaces and dashes are allowed. */
const mobile = () =>
  text(30).refine(
    (v) => /^(\+8801|01)[3-9]\d{8}$/.test(v.replace(/[\s-]/g, '')),
    'Enter a valid mobile number',
  );
const PICK_CENTER = 'Auction center is required';

const brokerSchema = z.object({
  brokerCode: text(50),
  brokerName: text(160),
  licenseNo: text(60),
  contactPersonName: text(120),
  designation: oneOf(valuesOf(DESIGNATIONS)),
  phone: optText(30),
  email: optEmail(),
  tinNo: optText(40),
  commission: num('Cannot be negative.').refine((v) => v <= 100, 'Must be 100 or less.'),
  status: oneOf(valuesOf(STATUSES)),
  address: text(500),
  remarks: optText(500),
  auctionCenters: z
    .array(z.string().trim().length(26, 'Select a value from the list.'), { error: PICK_CENTER })
    .min(1, PICK_CENTER)
    .transform((ids) => [...new Set(ids)]),
  association: oneOf(valuesOf(ASSOCIATIONS)),
});

const mobileSchema = z.object({
  mobileNumber: mobile(),
  contactPersonName: optText(120),
  designation: optOneOf(valuesOf(DESIGNATIONS)),
  type: oneOf(valuesOf(MOBILE_TYPES)),
  isPrimary: bool().transform((v) => v === true),
});

/** "06/06/2026 10:15 AM", as the Broker Summary shows Created On. */
function stamp(value: unknown) {
  if (!(value instanceof Date)) return null;
  const d = new Date(value.getTime() + 6 * 3_600_000); // Bangladesh time
  const two = (n: number) => String(n).padStart(2, '0');
  const hours = d.getUTCHours();
  return `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${two(hours % 12 || 12)}:${two(d.getUTCMinutes())} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** Brokers that work at one auction center (a JSON list of ids). */
const atCenter = (id: string) => ({ auctionCenters: { array_contains: [id] } });

export const brokersRouter = defineResource('/brokers', {
  name: 'broker',
  label: 'Broker',
  module: 'master',
  page: 'Add New Broker',
  describe: (r) => show(r.brokerCode, paren(r.brokerName)),
  model: 'broker',
  schema: brokerSchema,
  search: ['brokerCode', 'brokerName', 'licenseNo', 'contactPersonName', 'email'],
  filters: ['designation', 'association', 'status', { name: 'auctionCenter', where: atCenter }],
  refs: { auctionCenters: { model: 'auctionCenter', label: 'centerName' } },
  unique: ['brokerCode'],
  children: [{ key: 'mobileNumbers', model: 'brokerMobile', parentKey: 'brokerId', schema: mobileSchema }],
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  // RP1-114: a broker stays while a sale position names it.
  deleteCheck: async (row) => {
    const used = await positionsOfBroker(row.id);
    return used ? `This broker holds ${used} sale position${used === 1 ? '' : 's'}.` : undefined;
  },
  check: (_values, id, rows) => {
    const fields: Record<string, string> = {};
    const list = rows?.mobileNumbers;
    // An edit that leaves the rows out keeps them; a create or an edit that sends them needs one.
    if ((!id || list !== undefined) && !(list ?? []).length)
      fields.mobileNumbers = 'Add at least one mobile number.';
    if (((list ?? []) as { isPrimary?: unknown }[]).filter((r) => r.isPrimary === true).length > 1)
      fields.mobileNumbers = 'Only one mobile number can be Primary.';
    return Promise.resolve(fields);
  },
  extend: (row) => ({
    designationLabel: labelOf(DESIGNATIONS, row.designation),
    associationLabel: labelOf(ASSOCIATIONS, row.association),
    statusLabel: labelOf(STATUSES, row.status),
  }),
  /** The Broker Summary panel, shaped like `previewData`. */
  enrich: async (rows) => {
    const mobiles = await db.brokerMobile.findMany({
      where: { brokerId: { in: rows.map((r) => r.id) } },
      select: { brokerId: true, isPrimary: true },
    });
    const users = await db.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => String(r.createdBy)))] } },
      select: { id: true, name: true },
    });
    return new Map(
      rows.map((r) => {
        const own = mobiles.filter((m) => m.brokerId === r.id);
        const primary = own.filter((m) => m.isPrimary).length;
        const centers = Array.isArray(r.auctionCenters) ? r.auctionCenters.length : 0;
        const designation = labelOf(DESIGNATIONS, r.designation);
        return [
          r.id,
          {
            brokerSummary: {
              brokerCode: r.brokerCode,
              brokerName: r.brokerName,
              licenseNo: r.licenseNo,
              contactPerson: show(r.contactPersonName, paren(designation)),
              phone: r.phone ?? null,
              mobileNumbers: `${own.length} (${primary} Primary, ${own.length - primary} Others)`,
              email: r.email ?? null,
              auctionCenters: `${centers} Center(s)`,
              association: labelOf(ASSOCIATIONS, r.association),
              commission: `${Number(r.commission).toFixed(2)}%`,
              status: labelOf(STATUSES, r.status),
              createdBy: users.find((u) => u.id === r.createdBy)?.name ?? null,
              createdOn: stamp(r.createdAt),
            },
            totalMobileNumbers: own.length,
          },
        ];
      }),
    );
  },
  /** Cards for the Broker List (an addition: the prototype has no list). */
  summary: async (where) => {
    const groups = await db.broker.groupBy({ by: ['status'], where, _count: { _all: true } });
    const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
    return {
      totalBrokers: groups.reduce((sum, g) => sum + g._count._all, 0),
      activeBrokers: count('active'),
      inactiveBrokers: count('inactive'),
    };
  },
  export: {
    fileName: 'brokers',
    sheet: 'Brokers',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Broker Code', value: (row) => row.brokerCode, width: 14 },
      { header: 'Broker Name', value: (row) => row.brokerName, width: 28 },
      { header: 'License No.', value: (row) => row.licenseNo, width: 16 },
      { header: 'Contact Person', value: (row) => row.contactPersonName, width: 24 },
      { header: 'Designation', value: (row) => row.designationLabel, width: 20 },
      { header: 'Phone (Landline)', value: (row) => row.phone, width: 18 },
      { header: 'Email', value: (row) => row.email, width: 28 },
      {
        header: 'Auction Center(s)',
        value: (row) => (Array.isArray(row.auctionCentersName) ? row.auctionCentersName.join(', ') : null),
        width: 50,
      },
      { header: 'Association', value: (row) => row.associationLabel, width: 40 },
      { header: 'Commission (%)', value: (row) => row.commission, width: 14, numFmt: '0.00' },
      { header: 'Status', value: (row) => row.statusLabel, width: 10 },
    ],
  },
  options: {
    path: 'brokers',
    label: (row) => String(row.brokerName),
    filters: ['status', 'association'],
  },
});

/** The form's dropdowns and the list's filters; Auction Center(s) come from `/options/auction-centers`. */
export const brokerExtrasRouter = Router();
brokerExtrasRouter.get('/filter-options', (_req, res) => {
  const numbered = (list: Option[]) => list.map((o, i) => ({ id: i + 1, ...o }));
  res.json({
    designations: numbered(DESIGNATIONS),
    mobileTypes: numbered(MOBILE_TYPES),
    associations: numbered(ASSOCIATIONS),
    statuses: numbered(STATUSES),
  });
});
docsPaths['/brokers/filter-options'] = {
  get: {
    tags: ['Broker'],
    summary: 'Add New Broker form and filter options: designations, mobileTypes, associations, statuses',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};

/** RP1-111: how many live brokers work at an auction center (its delete guard). */
export const brokersAtCenter = (id: string) =>
  db.broker.count({ where: { ...atCenter(id), deletedAt: null } });
