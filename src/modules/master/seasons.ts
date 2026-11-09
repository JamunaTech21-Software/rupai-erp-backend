import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { oneOf, optText, reqDate, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-93 K.1 Season: `Season.jsx`, built from `seasonData.js`, so the keys are its field `name`s and the values
 * its option `value`s. The list's "current" badge is an Active season that today falls in. The overview's
 * production and sales are 0 until those modules are built.
 */
const SEASON_TYPES = [
  { value: 'main', label: 'Main Season', short: 'Main' },
  { value: 'off-season', label: 'Off Season', short: 'Off Season' },
];
const SEASON_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'inactive', label: 'Inactive' },
];
const values = (list: { value: string }[]) => list.map((o) => o.value);

const seasonSchema = z.object({
  seasonName: text(120),
  seasonCode: text(40),
  seasonType: oneOf(values(SEASON_TYPES)),
  startDate: reqDate(),
  endDate: reqDate(),
  status: oneOf(values(SEASON_STATUSES)),
  description: optText(500),
  remarks: optText(500),
});

const DAY_MS = 86_400_000;
/** Today in Bangladesh, as midnight UTC like a saved date. */
const today = () => new Date(`${new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10)}T00:00:00Z`);

const isCurrent = (row: Record<string, unknown>, now = today()) =>
  row.status === 'active' &&
  row.startDate instanceof Date &&
  row.endDate instanceof Date &&
  row.startDate <= now &&
  row.endDate >= now;

const labelOf = (list: { value: string; label: string }[], value: unknown) =>
  list.find((o) => o.value === value)?.label ?? null;

/** The season overview's Current Season Duration: days so far, both ends counted. */
function daysSoFar(startDate: Date, endDate: Date, now = today()) {
  const end = endDate < now ? endDate : now;
  return Math.round((end.getTime() - startDate.getTime()) / DAY_MS) + 1;
}

export const seasonsRouter = defineResource('/seasons', {
  name: 'season',
  label: 'Season',
  module: 'master',
  page: 'Season',
  describe: (r) => show(r.seasonCode, paren(r.seasonName)),
  model: 'season',
  schema: seasonSchema,
  search: ['seasonName', 'seasonCode'],
  filters: [
    'seasonType',
    'status',
    {
      // A season shows under every year it runs in.
      name: 'year',
      where: (v) => {
        if (!/^\d{4}$/.test(v)) return {};
        return {
          startDate: { lt: new Date(`${Number(v) + 1}-01-01T00:00:00Z`) },
          endDate: { gte: new Date(`${v}-01-01T00:00:00Z`) },
        };
      },
    },
  ],
  unique: ['seasonCode'],
  // The prototype's order: latest first, a year's main season before its off season.
  orderBy: [{ endDate: 'desc' }, { startDate: 'asc' }],
  check: (form) => {
    const fields: Record<string, string> = {};
    if (form.startDate instanceof Date && form.endDate instanceof Date && form.endDate < form.startDate)
      fields.endDate = 'End date must be on or after the start date.';
    return Promise.resolve(fields);
  },
  extend: (row) => ({
    seasonTypeLabel: SEASON_TYPES.find((o) => o.value === row.seasonType)?.short ?? null,
    statusLabel: labelOf(SEASON_STATUSES, row.status),
    current: isCurrent(row),
  }),
  summary: async (where) => {
    const rows = await db.season.findMany({
      where,
      select: { startDate: true, endDate: true, status: true },
      orderBy: { startDate: 'desc' },
    });
    const current = rows.find((r) => isCurrent(r));
    return {
      totalSeasons: rows.length,
      activeSeasons: rows.filter((r) => r.status === 'active').length,
      completedSeasons: rows.filter((r) => r.status === 'completed').length,
      currentSeasonDuration: current ? daysSoFar(current.startDate, current.endDate) : 0,
      totalProduction: 0,
      totalSales: 0,
    };
  },
  export: {
    fileName: 'seasons',
    sheet: 'Seasons',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Season Name', value: (row) => row.seasonName, width: 26 },
      { header: 'Season Code', value: (row) => row.seasonCode, width: 14 },
      { header: 'Start Date', value: (row) => row.startDate, width: 14 },
      { header: 'End Date', value: (row) => row.endDate, width: 14 },
      { header: 'Type', value: (row) => row.seasonTypeLabel, width: 14 },
      { header: 'Status', value: (row) => row.statusLabel, width: 12 },
      { header: 'Created By', value: (row) => row.createdByName, width: 22 },
      { header: 'Created On', value: (row) => row.createdAt, width: 22 },
    ],
  },
  // RP1-108: a season stays while an auction schedule row uses it.
  deleteCheck: async (row) => {
    const used = await db.auctionSchedule.count({ where: { season: row.id, deletedAt: null } });
    return used ? `This season is used by ${used} auction schedule row${used === 1 ? '' : 's'}.` : undefined;
  },
  options: { path: 'seasons', label: (row) => String(row.seasonName), filters: ['status'] },
});

/** The Filters panel and form dropdowns; Year holds every year a saved season runs in, latest first. */
export const seasonExtrasRouter = Router();
seasonExtrasRouter.get('/filter-options', async (_req, res) => {
  const saved = await db.season.findMany({
    where: { deletedAt: null },
    select: { startDate: true, endDate: true },
  });
  const years = new Set<number>();
  for (const { startDate, endDate } of saved)
    for (let y = startDate.getUTCFullYear(); y <= endDate.getUTCFullYear(); y += 1) years.add(y);
  const numbered = (list: { value: string; label: string }[]) =>
    list.map(({ value, label }, i) => ({ id: i + 1, value, label }));
  res.json({
    seasonTypes: numbered(SEASON_TYPES),
    statuses: numbered(SEASON_STATUSES),
    years: numbered([...years].sort((a, b) => b - a).map((y) => ({ value: String(y), label: String(y) }))),
  });
});
docsPaths['/seasons/filter-options'] = {
  get: {
    tags: ['Season'],
    summary: 'Season filter and form options: seasonTypes, statuses, years',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};
