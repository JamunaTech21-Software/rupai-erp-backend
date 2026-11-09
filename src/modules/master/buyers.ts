import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { bool, oneOf, optEmail, optOneOf, optText, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-117 K.9 Buyer Setup: `BuyerSetup.jsx`, built from `buyerSetupData.js`, so the keys are its field `name`s
 * and the values its option `value`s. The Contact Persons & Mobile Numbers table is `contactPersons`. The
 * prototype's sample rows hold designation labels; the form sends the option values, as here.
 */
const BUYER_TYPES = [
  { value: 'LOCAL', label: 'Local' },
  { value: 'EXPORTER', label: 'Exporter' },
  { value: 'PACKER', label: 'Packer' },
  { value: 'TRADER', label: 'Trader' },
  { value: 'CORPORATE', label: 'Corporate' },
];
const TRADING_TYPES = [
  { value: 'INTERNAL', label: 'Internal' },
  { value: 'EXPORT', label: 'Export' },
  { value: 'IMPORT', label: 'Import' },
  { value: 'BOTH', label: 'Both (Int–Exp)' },
];
const COUNTRIES = [
  { value: 'BANGLADESH', label: 'Bangladesh' },
  { value: 'INDIA', label: 'India' },
  { value: 'PAKISTAN', label: 'Pakistan' },
  { value: 'SRI_LANKA', label: 'Sri Lanka' },
  { value: 'KENYA', label: 'Kenya' },
  { value: 'UNITED_KINGDOM', label: 'United Kingdom' },
];
const CONTACT_TYPES = [
  { value: 'PRIMARY', label: 'Primary' },
  { value: 'SECONDARY', label: 'Secondary' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'OFFICE', label: 'Office' },
];
const DESIGNATIONS = [
  { value: 'MANAGING_DIRECTOR', label: 'Managing Director' },
  { value: 'GENERAL_MANAGER', label: 'General Manager' },
  { value: 'ACCOUNTS_MANAGER', label: 'Accounts Manager' },
  { value: 'MARKETING_EXECUTIVE', label: 'Marketing Executive' },
  { value: 'SALES_MANAGER', label: 'Sales Manager' },
  { value: 'PURCHASE_MANAGER', label: 'Purchase Manager' },
];
const STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

type Option = { value: string; label: string };
const valuesOf = (list: Option[]) => list.map((o) => o.value);
const labelOf = (list: Option[], value: unknown) => list.find((o) => o.value === value)?.label ?? null;

/** The prototype writes numbers as +880-1711-123456, so spaces and dashes are allowed. */
const mobile = () =>
  text(30).refine(
    (v) => /^(\+8801|01)[3-9]\d{8}$/.test(v.replace(/[\s-]/g, '')),
    'Enter a valid mobile number',
  );

const buyerSchema = z.object({
  buyerCode: text(50),
  buyerName: text(150),
  shortName: optText(50),
  buyerType: oneOf(valuesOf(BUYER_TYPES)),
  tradingType: oneOf(valuesOf(TRADING_TYPES)),
  country: oneOf(valuesOf(COUNTRIES)),
  address: text(250),
  phone: optText(30),
  email: optEmail(),
  status: oneOf(valuesOf(STATUSES)),
  remarks: optText(250),
});

const contactSchema = z.object({
  mobileNumber: mobile(),
  contactPersonName: text(120),
  designation: oneOf(valuesOf(DESIGNATIONS)),
  type: optOneOf(valuesOf(CONTACT_TYPES)),
  isPrimary: bool().transform((v) => v === true),
});

export const buyersRouter = defineResource('/buyers', {
  name: 'buyer',
  label: 'Buyer',
  module: 'master',
  page: 'Buyer Setup',
  describe: (r) => show(r.buyerCode, paren(r.buyerName)),
  model: 'buyer',
  schema: buyerSchema,
  search: ['buyerCode', 'buyerName', 'shortName', 'email', 'phone'],
  searchAlso: (term) => [
    {
      contactPersons: {
        some: { OR: [{ mobileNumber: { contains: term } }, { contactPersonName: { contains: term } }] },
      },
    },
  ],
  filters: ['buyerType', 'tradingType', 'country', 'status'],
  unique: ['buyerCode'],
  children: [{ key: 'contactPersons', model: 'buyerContact', parentKey: 'buyerId', schema: contactSchema }],
  // The prototype's order: new buyers at the end.
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  check: (_values, id, rows) => {
    const fields: Record<string, string> = {};
    const list = rows?.contactPersons;
    // An edit that leaves the rows out keeps them; a create or an edit that sends them needs one.
    if ((!id || list !== undefined) && !(list ?? []).length)
      fields.contactPersons = 'Add at least one contact person.';
    if (((list ?? []) as { isPrimary?: unknown }[]).filter((r) => r.isPrimary === true).length > 1)
      fields.contactPersons = 'Only one mobile number can be Primary.';
    return Promise.resolve(fields);
  },
  extend: (row) => ({
    buyerTypeLabel: labelOf(BUYER_TYPES, row.buyerType),
    tradingTypeLabel: labelOf(TRADING_TYPES, row.tradingType),
    countryLabel: labelOf(COUNTRIES, row.country),
    statusLabel: labelOf(STATUSES, row.status),
  }),
  /** The list's Mobile (Primary) column: the Primary row, or the first row when none is marked. */
  enrich: async (rows) => {
    const contacts = await db.buyerContact.findMany({
      where: { buyerId: { in: rows.map((r) => r.id) } },
      orderBy: { position: 'asc' },
      select: { buyerId: true, mobileNumber: true, contactPersonName: true, isPrimary: true },
    });
    return new Map(
      rows.map((r) => {
        const own = contacts.filter((c) => c.buyerId === r.id);
        const primary = own.find((c) => c.isPrimary) ?? own[0];
        return [
          r.id,
          {
            mobilePrimary: primary?.mobileNumber ?? null,
            primaryContactName: primary?.contactPersonName ?? null,
            totalContacts: own.length,
          },
        ];
      }),
    );
  },
  summary: async (where) => {
    const groups = await db.buyer.groupBy({ by: ['status'], where, _count: { _all: true } });
    const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
    return {
      totalBuyers: groups.reduce((sum, g) => sum + g._count._all, 0),
      activeBuyers: count('ACTIVE'),
      inactiveBuyers: count('INACTIVE'),
    };
  },
  export: {
    fileName: 'buyers',
    sheet: 'Buyers',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Buyer Code', value: (row) => row.buyerCode, width: 12 },
      { header: 'Buyer Name', value: (row) => row.buyerName, width: 32 },
      { header: 'Short Name', value: (row) => row.shortName, width: 16 },
      { header: 'Buyer Type', value: (row) => row.buyerTypeLabel, width: 12 },
      { header: 'Trading Type', value: (row) => row.tradingTypeLabel, width: 16 },
      { header: 'Country', value: (row) => row.countryLabel, width: 16 },
      { header: 'Mobile (Primary)', value: (row) => row.mobilePrimary, width: 18 },
      { header: 'Phone', value: (row) => row.phone, width: 16 },
      { header: 'Status', value: (row) => row.statusLabel, width: 10 },
    ],
  },
  options: { path: 'buyers', label: (row) => String(row.buyerName), filters: ['status', 'buyerType'] },
});

/** The form's dropdowns and the list's filters. */
export const buyerExtrasRouter = Router();
buyerExtrasRouter.get('/filter-options', (_req, res) => {
  const numbered = (list: Option[]) => list.map((o, i) => ({ id: i + 1, ...o }));
  res.json({
    buyerTypes: numbered(BUYER_TYPES),
    tradingTypes: numbered(TRADING_TYPES),
    countries: numbered(COUNTRIES),
    contactTypes: numbered(CONTACT_TYPES),
    designations: numbered(DESIGNATIONS),
    statuses: numbered(STATUSES),
  });
});
docsPaths['/buyers/filter-options'] = {
  get: {
    tags: ['Buyer'],
    summary:
      'Buyer Setup form and filter options: buyerTypes, tradingTypes, countries, contactTypes, designations, statuses',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
