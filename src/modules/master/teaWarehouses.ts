import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { bool, oneOf, optNum, optText, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-102 K.4 Tea Warehouse: `TeaWarehouse.jsx`, built from `teaWarehouseData.js`, so the keys are its field
 * `name`s and the values its option `value`s. The prototype has no list, so the Warehouse List is added, in the
 * Estate Profile List's style. Its form has no Status, though its summary shows one: `status` is optional, a new
 * warehouse is Active and an edit that leaves it out keeps the saved value.
 */
const WAREHOUSE_TYPES = [
  { value: 'main', label: 'Main Warehouse' },
  { value: 'factory', label: 'Factory Warehouse' },
  { value: 'raw_material', label: 'Raw Material Warehouse' },
  { value: 'finished_goods', label: 'Finished Goods Warehouse' },
  { value: 'temporary', label: 'Temporary Warehouse' },
];
const MOBILE_TYPES = [
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'office', label: 'Office' },
  { value: 'other', label: 'Other' },
];
const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];
const valuesOf = (list: { value: string }[]) => list.map((o) => o.value);
const labelOf = (list: { value: string; label: string }[], value: unknown) =>
  list.find((o) => o.value === value)?.label ?? null;

/** The prototype writes numbers as +880-1711-123456, so spaces and dashes are allowed. */
const mobile = () =>
  text(30).refine(
    (v) => /^(\+8801|01)[3-9]\d{8}$/.test(v.replace(/[\s-]/g, '')),
    'Enter a valid phone number',
  );

const warehouseSchema = z.object({
  warehouseCode: text(50),
  warehouseName: text(120),
  shortName: optText(50),
  location: text(250),
  warehouseType: oneOf(valuesOf(WAREHOUSE_TYPES)),
  capacity: optNum(),
  inChargePerson: text(120),
  officePhone: optText(30),
  status: z.preprocess((v) => (v === '' || v === null ? undefined : v), oneOf(valuesOf(STATUSES)).optional()),
});

const mobileSchema = z.object({
  number: mobile(),
  contactPerson: text(120),
  designation: optText(120),
  type: oneOf(valuesOf(MOBILE_TYPES)),
  primary: bool(),
});

export const teaWarehousesRouter = defineResource('/tea-warehouses', {
  name: 'teaWarehouse',
  label: 'Tea warehouse',
  module: 'master',
  page: 'Tea Warehouse',
  describe: (r) => show(r.warehouseCode, paren(r.warehouseName)),
  model: 'teaWarehouse',
  schema: warehouseSchema,
  search: ['warehouseCode', 'warehouseName', 'shortName', 'location', 'inChargePerson'],
  filters: ['warehouseType', 'status'],
  unique: ['warehouseCode'],
  children: [
    { key: 'mobileNumbers', model: 'teaWarehouseMobile', parentKey: 'warehouseId', schema: mobileSchema },
  ],
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  check: (_values, _id, rows) => {
    const fields: Record<string, string> = {};
    const list = (rows?.mobileNumbers ?? []) as { primary?: unknown }[];
    if (list.filter((r) => r.primary === true).length > 1)
      fields.mobileNumbers = 'Only one mobile number can be Primary.';
    return Promise.resolve(fields);
  },
  onCreate: (values) => ({ status: values.status ?? 'active' }),
  extend: (row) => ({
    warehouseTypeLabel: labelOf(WAREHOUSE_TYPES, row.warehouseType),
    statusLabel: labelOf(STATUSES, row.status ?? 'active'),
  }),
  /** The Warehouse Summary panel: Total Mobile Numbers and Primary Contact. */
  enrich: async (rows) => {
    const mobiles = await db.teaWarehouseMobile.findMany({
      where: { warehouseId: { in: rows.map((r) => r.id) } },
      select: { warehouseId: true, number: true, contactPerson: true, primary: true },
    });
    return new Map(
      rows.map((r) => {
        const own = mobiles.filter((m) => m.warehouseId === r.id);
        const primary = own.find((m) => m.primary);
        return [
          r.id,
          {
            totalMobileNumbers: own.length,
            primaryContact: primary ? `${primary.contactPerson} (${primary.number})` : null,
          },
        ];
      }),
    );
  },
  export: {
    fileName: 'tea-warehouses',
    sheet: 'Tea Warehouses',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Warehouse Code', value: (row) => row.warehouseCode, width: 16 },
      { header: 'Warehouse Name', value: (row) => row.warehouseName, width: 28 },
      { header: 'Short Name', value: (row) => row.shortName, width: 14 },
      { header: 'Warehouse Type', value: (row) => row.warehouseTypeLabel, width: 24 },
      { header: 'Location / Address', value: (row) => row.location, width: 36 },
      { header: 'Capacity (MT)', value: (row) => row.capacity, width: 14, numFmt: '#,##0.00' },
      { header: 'In-Charge Person', value: (row) => row.inChargePerson, width: 22 },
      { header: 'Primary Contact', value: (row) => row.primaryContact, width: 34 },
      { header: 'Status', value: (row) => row.statusLabel, width: 10 },
    ],
  },
  options: { path: 'tea-warehouses', label: (row) => String(row.warehouseName), filters: ['status'] },
});

/** The form's dropdowns and the list's filters. */
export const teaWarehouseExtrasRouter = Router();
teaWarehouseExtrasRouter.get('/filter-options', (_req, res) => {
  const numbered = (list: { value: string; label: string }[]) => list.map((o, i) => ({ id: i + 1, ...o }));
  res.json({
    warehouseTypes: numbered(WAREHOUSE_TYPES),
    mobileTypes: numbered(MOBILE_TYPES),
    statuses: numbered(STATUSES),
  });
});
docsPaths['/tea-warehouses/filter-options'] = {
  get: {
    tags: ['Tea warehouse'],
    summary: 'Tea Warehouse form and filter options: warehouseTypes, mobileTypes, statuses',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
