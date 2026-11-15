import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, pendingValues, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { int, oneOf, optText, ref, reqDate, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-108 K.6 Auction Schedule (Annual Calendar): `AuctionSchedule.jsx`, built from `auctionSheduleData.js`.
 * The form's names are `seasonId`, `auctionCenterId`, `yearId` on the page; here they are `season`,
 * `auctionCenter` and `year`, like the other pages that pick a saved record. Status values are the page's
 * codes (SCHEDULED …).
 *
 * RP1-188 P.3: Sale No. is a form field. It is required when sent (1 or more, unique for the season and
 * auction center) and can be changed on an edit; broker sale positions point to the sale, so they follow.
 * `GET /auction-schedules/next-sale-no` suggests the next free number. A body without the key (a page built
 * before RP1-188) still works: a new row gets the next number, an edit keeps the saved one. Sale Day is worked
 * out from Sale Date.
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
  // Required when sent; left out, see onCreate / check (RP1-188).
  saleNo: int('Must be 1 or more.')
    .refine((v) => v >= 1, 'Must be 1 or more.')
    .optional(),
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
  orderBy: [{ saleDate: 'asc' }, { saleNo: 'asc' }, { id: 'asc' }],
  onSave: (data) => ({ saleDay: dayOf(data.saleDate) }),
  /** Left out, Sale No. is the next free number of the season and auction center. */
  onCreate: async (data) =>
    typeof data.saleNo === 'number'
      ? {}
      : { saleNo: await nextSaleNo(String(data.season), String(data.auctionCenter)) },
  check: async (values, id) => {
    const fields: Record<string, string> = {};
    const sale = time(values.saleDate);
    if (time(values.buyerPromptDate) > sale) fields.buyerPromptDate = 'Must not be after the sale date.';
    if (time(values.catalogueClosingDate) > sale)
      fields.catalogueClosingDate = 'Must not be after the sale date.';
    const before = id ? await db.auctionSchedule.findUnique({ where: { id } }) : null;
    // RP1-114: a sale with broker positions stays at its center.
    if (before && before.auctionCenter !== values.auctionCenter) {
      const used = await db.brokerSalePosition.count({ where: { auctionSchedule: id, deletedAt: null } });
      if (used) fields.auctionCenter = 'This sale has broker positions, so its auction center cannot change.';
    }
    // RP1-188: the Sale No. (sent, or kept on an edit) must be free for the season and auction center.
    const saleNo = typeof values.saleNo === 'number' ? values.saleNo : before?.saleNo;
    if (
      typeof saleNo === 'number' &&
      typeof values.season === 'string' &&
      typeof values.auctionCenter === 'string'
    ) {
      const taken = await db.auctionSchedule.count({
        where: {
          season: values.season,
          auctionCenter: values.auctionCenter,
          saleNo,
          deletedAt: null,
          ...(id ? { NOT: { id } } : {}),
        },
      });
      if (taken) fields.saleNo = `Sale No. ${saleNo} is already used for this season and auction center.`;
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
 * RP1-188: the next free Sale No. of a season and auction center: one more than the highest saved or waiting
 * for approval (so two new rows are not offered the same number).
 */
export async function nextSaleNo(season: string, auctionCenter: string) {
  const [last, waiting] = await Promise.all([
    db.auctionSchedule.aggregate({
      where: { season, auctionCenter, deletedAt: null },
      _max: { saleNo: true },
    }),
    pendingValues('auctionSchedule'),
  ]);
  const asked = waiting
    .filter((v) => v.season === season && v.auctionCenter === auctionCenter && typeof v.saleNo === 'number')
    .map((v) => v.saleNo as number);
  return Math.max(last._max.saleNo ?? 0, ...asked) + 1;
}

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
/** RP1-188: the form's suggested Sale No. once Season and Auction Center are picked. */
auctionScheduleExtrasRouter.get('/next-sale-no', async (req, res) => {
  const pick = (v: unknown) => (typeof v === 'string' && v.length === 26 ? v : null);
  const season = pick(req.query.season);
  const auctionCenter = pick(req.query.auctionCenter);
  const fields: Record<string, string> = {};
  if (!season) fields.season = 'Select a season.';
  if (!auctionCenter) fields.auctionCenter = 'Select an auction center.';
  if (!season || !auctionCenter)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', fields);
  res.json({ season, auctionCenter, saleNo: await nextSaleNo(season, auctionCenter) });
});
docsPaths['/auction-schedules/next-sale-no'] = {
  get: {
    tags: ['Auction schedule'],
    summary: 'The next free Sale No. for ?season=&auctionCenter= (ids): { season, auctionCenter, saleNo }',
    responses: {
      '200': { description: '{ saleNo }' },
      '400': { description: 'season / auctionCenter missing' },
    },
  },
};
docsPaths['/auction-schedules/filter-options'] = {
  get: {
    tags: ['Auction schedule'],
    summary: 'Auction Schedule filters and form options: years, statuses, currentYear',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
