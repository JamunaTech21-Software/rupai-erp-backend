import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { oneOf, optInt, optText, ref, reqDate, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-108 K.6 Auction Schedule (Annual Calendar): `AuctionSchedule.jsx`, built from `auctionSheduleData.js`.
 * The form's names are `seasonId`, `auctionCenterId`, `yearId` on the page; here they are `season`,
 * `auctionCenter` and `year`, like the other pages that pick a saved record. Status values are the page's
 * codes (SCHEDULED …).
 *
 * The form has no Sale No. field, so a new row is numbered by the server: the next number of its season and
 * auction center. A number may also be sent (an import). Sale No. stays as it is on an edit. Sale Day is
 * worked out from Sale Date.
 */
const STATUSES = [
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'HOLIDAY', label: 'Holiday' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Option = { value: string; label: string };
const valuesOf = (list: Option[]) => list.map((o) => o.value);
const labelOf = (list: Option[], value: unknown) => list.find((o) => o.value === value)?.label ?? null;

const YEAR_MESSAGE = 'Use the format 2026-2027.';
const year = () =>
  text(9)
    .regex(/^\d{4}-\d{4}$/, YEAR_MESSAGE)
    .refine((v) => Number(v.slice(5)) === Number(v.slice(0, 4)) + 1, YEAR_MESSAGE);

const scheduleSchema = z.object({
  season: ref(),
  auctionCenter: ref(),
  year: year(),
  saleNo: optInt('Must be 1 or more.').refine((v) => v === null || v >= 1, 'Must be 1 or more.'),
  saleDate: reqDate(),
  buyerPromptDate: reqDate(),
  catalogueClosingDate: reqDate(),
  comments: optText(500),
  status: oneOf(valuesOf(STATUSES)),
});

const dayOf = (value: unknown) => (value instanceof Date ? (DAYS[value.getUTCDay()] ?? '') : '');
const time = (value: unknown) => (value instanceof Date ? value.getTime() : Number.NaN);
const iso = (value: unknown) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : typeof value === 'string'
      ? value.slice(0, 10)
      : null;

/** The auction year a date falls in: April to March, as the prototype's 2026-2027 runs from April 2026. */
function auctionYear(date: Date) {
  const start = date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return `${start}-${start + 1}`;
}

export const auctionSchedulesRouter = defineResource('/auction-schedules', {
  name: 'auctionSchedule',
  label: 'Auction schedule',
  module: 'master',
  page: 'Auction Schedule',
  // "Chattogram Tea Auction Centre, 2026 Main Season: Sale 5 (2026-06-01)"
  describe: (r) =>
    `${show(r.auctionCenterName)}, ${show(r.seasonName)}: ${show(typeof r.saleNo === 'number' ? `Sale ${r.saleNo}` : 'New sale', paren(iso(r.saleDate)))}`,
  model: 'auctionSchedule',
  schema: scheduleSchema,
  search: ['comments', 'year'],
  filters: ['season', 'auctionCenter', 'year', 'status'],
  refs: {
    season: { model: 'season', label: 'seasonName' },
    auctionCenter: { model: 'auctionCenter', label: 'centerName' },
  },
  unique: [{ field: 'saleNo', scope: ['season', 'auctionCenter'] }],
  createOnly: ['saleNo'],
  orderBy: [{ saleDate: 'asc' }, { saleNo: 'asc' }, { id: 'asc' }],
  onSave: (data) => ({ saleDay: dayOf(data.saleDate) }),
  /** Left empty, Sale No. is the next number of the season and auction center. */
  onCreate: async (data) => {
    if (typeof data.saleNo === 'number') return {};
    const last = await db.auctionSchedule.aggregate({
      where: { season: String(data.season), auctionCenter: String(data.auctionCenter), deletedAt: null },
      _max: { saleNo: true },
    });
    return { saleNo: (last._max.saleNo ?? 0) + 1 };
  },
  check: async (values, id) => {
    const fields: Record<string, string> = {};
    const sale = time(values.saleDate);
    if (time(values.buyerPromptDate) > sale) fields.buyerPromptDate = 'Must not be after the sale date.';
    if (time(values.catalogueClosingDate) > sale)
      fields.catalogueClosingDate = 'Must not be after the sale date.';
    // An edit keeps its Sale No.; moved to another season or center, that number must be free there.
    if (id) {
      const before = await db.auctionSchedule.findUnique({ where: { id } });
      // RP1-114: a sale with broker positions stays at its center.
      if (before && before.auctionCenter !== values.auctionCenter) {
        const used = await db.brokerSalePosition.count({ where: { auctionSchedule: id, deletedAt: null } });
        if (used)
          fields.auctionCenter = 'This sale has broker positions, so its auction center cannot change.';
      }
      if (before && (before.season !== values.season || before.auctionCenter !== values.auctionCenter)) {
        const taken = await db.auctionSchedule.count({
          where: {
            season: String(values.season),
            auctionCenter: String(values.auctionCenter),
            saleNo: before.saleNo,
            deletedAt: null,
            NOT: { id },
          },
        });
        if (taken)
          fields.auctionCenter = `Sale No. ${before.saleNo} is already used for this season and auction center.`;
      }
    }
    return fields;
  },
  // RP1-114: a sale stays while broker positions use it.
  deleteCheck: async (row) => {
    const used = await db.brokerSalePosition.count({ where: { auctionSchedule: row.id, deletedAt: null } });
    return used ? 'This sale has broker positions.' : undefined;
  },
  extend: (row) => ({ statusLabel: labelOf(STATUSES, row.status) }),
  /** The counts for the same filters as the list (`summary` in the data file). */
  summary: async (where) => {
    const groups = await db.auctionSchedule.groupBy({ by: ['status'], where, _count: { _all: true } });
    const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
    return {
      totalSchedules: groups.reduce((sum, g) => sum + g._count._all, 0),
      scheduled: count('SCHEDULED'),
      holidays: count('HOLIDAY'),
      completed: count('COMPLETED'),
      cancelled: count('CANCELLED'),
    };
  },
  export: {
    fileName: 'auction-schedule',
    sheet: 'Auction Schedule',
    columns: [
      { header: 'Season', value: (row) => row.seasonName, width: 20 },
      { header: 'Auction Center', value: (row) => row.auctionCenterName, width: 32 },
      { header: 'Year', value: (row) => row.year, width: 12 },
      { header: 'Sale No.', value: (row) => row.saleNo, width: 9 },
      { header: 'Sale Date', value: (row) => iso(row.saleDate), width: 12 },
      { header: 'Sale Day', value: (row) => row.saleDay, width: 12 },
      { header: 'Buyer Prompt Date', value: (row) => iso(row.buyerPromptDate), width: 18 },
      { header: 'Catalogue Closing Date', value: (row) => iso(row.catalogueClosingDate), width: 22 },
      { header: 'Comments', value: (row) => row.comments, width: 30 },
      { header: 'Status', value: (row) => row.statusLabel, width: 12 },
    ],
  },
  options: {
    path: 'auction-schedules',
    label: (row) => `Sale ${String(row.saleNo)} — ${iso(row.saleDate) ?? ''}`,
    filters: ['season', 'auctionCenter', 'year', 'status'],
  },
});

/**
 * The page's filters and dropdowns. Season and Auction Center come from `/options/seasons` and
 * `/options/auction-centers`. Years: the saved rows' years, this auction year and the next.
 */
export const auctionScheduleExtrasRouter = Router();
auctionScheduleExtrasRouter.get('/filter-options', async (_req, res) => {
  const saved = await db.auctionSchedule.findMany({
    where: { deletedAt: null },
    distinct: ['year'],
    select: { year: true },
  });
  const now = auctionYear(new Date());
  const next = `${Number(now.slice(5))}-${Number(now.slice(5)) + 1}`;
  const years = [...new Set([...saved.map((r) => r.year), now, next])].sort().reverse();
  res.json({
    years: years.map((value, i) => ({ id: i + 1, value, label: value })),
    statuses: STATUSES.map((o, i) => ({ id: i + 1, ...o })),
    currentYear: now,
  });
});
docsPaths['/auction-schedules/filter-options'] = {
  get: {
    tags: ['Auction schedule'],
    summary: 'Auction Schedule filters and form options: years, statuses, currentYear',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
