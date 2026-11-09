import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { oneOf, ref } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-114 K.8 Tea Brokers Sale Position: `BrokerSalePositionSetup.jsx`, built from `brokerSalePositionData.js`,
 * so the keys are its field `name`s. Auction Center is a saved center, Sale No is an Auction Schedule row of
 * that center (sent as `auctionSchedule`; its season and Sale No. come with it), and the 1st to 7th Brokers are
 * saved brokers. The form has no Status, though the list filters by it: `status` is optional, a new position is
 * Active and an edit that leaves it out keeps the saved value.
 */
const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];
export const BROKER_KEYS = [
  'broker1',
  'broker2',
  'broker3',
  'broker4',
  'broker5',
  'broker6',
  'broker7',
] as const;

type Option = { value: string; label: string };
const labelOf = (list: Option[], value: unknown) => list.find((o) => o.value === value)?.label ?? null;

const positionSchema = z.object({
  auctionCenter: ref(),
  auctionSchedule: ref(),
  ...Object.fromEntries(BROKER_KEYS.map((key) => [key, ref()])),
  status: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    oneOf(STATUSES.map((o) => o.value)).optional(),
  ),
});

const saleNoLabel = (n: unknown) => (typeof n === 'number' ? String(n).padStart(2, '0') : null);

export const brokerSalePositionsRouter = defineResource('/broker-sale-positions', {
  name: 'brokerSalePosition',
  label: 'Broker sale position',
  module: 'master',
  page: 'Tea Brokers Sale Position',
  // "Chattogram Tea Auction Centre: Sale 01"
  describe: (r) =>
    `${show(r.auctionCenterName)}: Sale ${show(saleNoLabel(Number(r.auctionScheduleName)) ?? '')}`.trim(),
  model: 'brokerSalePosition',
  schema: positionSchema,
  searchAlso: (term) => [
    { auctionCenterRef: { centerName: { contains: term } } },
    { auctionCenterRef: { shortName: { contains: term } } },
  ],
  search: ['status'],
  filters: [
    'auctionCenter',
    'status',
    { name: 'season', where: (v) => ({ auctionScheduleRef: { season: v } }) },
    {
      name: 'saleNo',
      where: (v) => ({ auctionScheduleRef: { saleNo: Number.isInteger(Number(v)) ? Number(v) : -1 } }),
    },
  ],
  refs: {
    auctionCenter: { model: 'auctionCenter', label: 'centerName' },
    // The sale's number, so Record Details reads "Sale 01".
    auctionSchedule: { model: 'auctionSchedule', label: ['saleNo'] },
    ...Object.fromEntries(BROKER_KEYS.map((key) => [key, { model: 'broker', label: 'brokerName' }])),
  },
  unique: ['auctionSchedule'],
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  check: async (values) => {
    const fields: Record<string, string> = {};
    const sale = await db.auctionSchedule.findFirst({
      where: { id: String(values.auctionSchedule), deletedAt: null },
      select: { auctionCenter: true },
    });
    if (sale && sale.auctionCenter !== values.auctionCenter)
      fields.auctionSchedule = 'This sale is not in the selected auction center’s schedule.';
    const seen = new Set<unknown>();
    for (const [i, key] of BROKER_KEYS.entries()) {
      if (seen.has(values[key])) fields[key] = `This broker already holds a position above ${ORDINALS[i]}.`;
      seen.add(values[key]);
    }
    return fields;
  },
  onCreate: (values) => ({ status: values.status ?? 'active' }),
  extend: (row) => ({ statusLabel: labelOf(STATUSES, row.status ?? 'active') }),
  /** The sale's season, Sale No. and date, and the brokers in order, for the list's columns. */
  enrich: async (rows) => {
    const sales = await db.auctionSchedule.findMany({
      where: { id: { in: rows.map((r) => String(r.auctionSchedule)) } },
      select: {
        id: true,
        saleNo: true,
        saleDate: true,
        season: true,
        seasonRef: { select: { seasonName: true } },
      },
    });
    const brokerIds = [...new Set(rows.flatMap((r) => BROKER_KEYS.map((k) => String(r[k]))))];
    const brokers = await db.broker.findMany({
      where: { id: { in: brokerIds } },
      select: { id: true, brokerName: true },
    });
    const name = new Map(brokers.map((b) => [b.id, b.brokerName]));
    return new Map(
      rows.map((r) => {
        const sale = sales.find((s) => s.id === r.auctionSchedule);
        return [
          r.id,
          {
            saleNo: sale?.saleNo ?? null,
            saleNoLabel: saleNoLabel(sale?.saleNo),
            saleDate: sale?.saleDate ?? null,
            season: sale?.season ?? null,
            seasonName: sale?.seasonRef.seasonName ?? null,
            brokers: BROKER_KEYS.map((k) => name.get(String(r[k])) ?? null),
          },
        ];
      }),
    );
  },
  export: {
    fileName: 'brokers-sale-position',
    sheet: 'Brokers Sale Position',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Auction Center', value: (row) => row.auctionCenterName, width: 32 },
      { header: 'Season', value: (row) => row.seasonName, width: 20 },
      { header: 'Sale No', value: (row) => row.saleNoLabel, width: 9 },
      ...BROKER_KEYS.map((key, i) => ({
        header: `${ORDINALS[i]} Brokers`,
        value: (row: Record<string, unknown>) => row[`${key}Name`],
        width: 28,
      })),
      { header: 'Status', value: (row) => row.statusLabel, width: 10 },
    ],
  },
});

/** The list's Status filter; centers, sales and brokers come from `/options/...`. */
export const brokerSalePositionExtrasRouter = Router();
brokerSalePositionExtrasRouter.get('/filter-options', (_req, res) => {
  res.json({ statuses: STATUSES.map((o, i) => ({ id: i + 1, ...o })) });
});
docsPaths['/broker-sale-positions/filter-options'] = {
  get: {
    tags: ['Broker sale position'],
    summary: 'Tea Brokers Sale Position filter options: statuses',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};

/** RP1-114: how many live positions name a broker (the broker's delete guard). */
export const positionsOfBroker = (id: string) =>
  db.brokerSalePosition.count({
    where: { deletedAt: null, OR: BROKER_KEYS.map((key) => ({ [key]: id })) },
  });
