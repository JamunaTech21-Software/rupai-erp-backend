import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { db } from '../../lib/db.js';

/**
 * RP1-120 K.10 Master Data Dashboard: `MasterDataDashboard.jsx`. `GET /master-data/summary` answers the parts of
 * `masterDataDashboardData.js` that come from saved data: `summaryCards`, `masterDataOverview`, `recentlyAdded`
 * and `masterDataHealth`, with the same ids, names, icons and paths. Unit of Measurement, Production Type and
 * Common Status have no pages yet, so they count 0. The page header, Quick Access and footer stay on the page.
 * Deleted records are left out. "Active" and "Inactive" are each page's own statuses; a warehouse saved without
 * a status is Active, as on its page. A Completed season counts in the total only (`completed`), so past
 * seasons do not make the health look bad.
 */
type Entry = {
  id: string;
  name: string;
  /** The card's title (plural). */
  title: string | null;
  icon: string;
  path: string;
  load: () => Promise<
    { name: string; status: string | null; createdAt: Date; createdBy: string; updatedAt: Date }[]
  >;
};

const live = { deletedAt: null };
const ENTRIES: Entry[] = [
  {
    id: 'season',
    name: 'Season',
    title: 'Seasons',
    icon: 'season',
    path: '/master-data-season',
    load: async () =>
      (
        await db.season.findMany({
          where: live,
          select: { seasonName: true, status: true, createdAt: true, createdBy: true, updatedAt: true },
        })
      ).map(({ seasonName, ...r }) => ({ name: seasonName, ...r })),
  },
  {
    id: 'tea-grade',
    name: 'Tea Grade',
    title: 'Tea Grades',
    icon: 'teaGrade',
    path: '/master-data-tea-grade',
    load: async () =>
      (
        await db.teaGrade.findMany({
          where: live,
          select: { gradeName: true, status: true, createdAt: true, createdBy: true, updatedAt: true },
        })
      ).map(({ gradeName, ...r }) => ({ name: gradeName, ...r })),
  },
  {
    id: 'tea-brokers',
    name: 'Tea Brokers',
    title: 'Tea Brokers',
    icon: 'teaBrokers',
    path: '/master-data-tea-brokers',
    load: async () =>
      (
        await db.broker.findMany({
          where: live,
          select: { brokerName: true, status: true, createdAt: true, createdBy: true, updatedAt: true },
        })
      ).map(({ brokerName, ...r }) => ({ name: brokerName, ...r })),
  },
  {
    id: 'auction-centers',
    name: 'Auction Centers',
    title: 'Auction Centers',
    icon: 'auctionCenters',
    path: '/master-data-auction-centers',
    load: async () =>
      (
        await db.auctionCenter.findMany({
          where: live,
          select: { centerName: true, status: true, createdAt: true, createdBy: true, updatedAt: true },
        })
      ).map(({ centerName, ...r }) => ({ name: centerName, ...r })),
  },
  {
    id: 'tea-warehouse',
    name: 'Tea Warehouse',
    title: 'Tea Warehouses',
    icon: 'teaWarehouse',
    path: '/master-data-tea-warehouse',
    load: async () =>
      (
        await db.teaWarehouse.findMany({
          where: live,
          select: { warehouseName: true, status: true, createdAt: true, createdBy: true, updatedAt: true },
        })
      ).map(({ warehouseName, status, ...r }) => ({ name: warehouseName, status: status ?? 'active', ...r })),
  },
  {
    id: 'unit-of-measurement',
    name: 'Unit of Measurement',
    title: null,
    icon: 'unitOfMeasurement',
    path: '/master-data-unit-of-measurement',
    load: () => Promise.resolve([]),
  },
  {
    id: 'tea-type',
    name: 'Tea Type',
    title: null,
    icon: 'teaType',
    path: '/master-data-tea-type',
    load: async () =>
      (
        await db.teaType.findMany({
          where: live,
          select: { teaTypeName: true, status: true, createdAt: true, createdBy: true, updatedAt: true },
        })
      ).map(({ teaTypeName, ...r }) => ({ name: teaTypeName, ...r })),
  },
  {
    id: 'production-type',
    name: 'Production Type',
    title: null,
    icon: 'productionType',
    path: '/master-data-production-type',
    load: () => Promise.resolve([]),
  },
  {
    id: 'common-status',
    name: 'Common Status',
    title: null,
    icon: 'commonStatus',
    path: '/master-data-common-status',
    load: () => Promise.resolve([]),
  },
];

/** Health is "healthy" while at most this share of the records is inactive. */
const HEALTHY_INACTIVE_PERCENT = 10;

const two = (n: number) => String(n).padStart(2, '0');
/** Bangladesh time (UTC+6), as the page shows dates. */
const local = (d: Date) => new Date(d.getTime() + 6 * 3_600_000);
const ddmmyyyy = (d: Date) => {
  const t = local(d);
  return `${two(t.getUTCDate())}/${two(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
};
/** "05/06/2026 10:15 AM" */
const stamp = (d: Date) => {
  const t = local(d);
  const h = t.getUTCHours();
  return `${ddmmyyyy(d)} ${two(h % 12 || 12)}:${two(t.getUTCMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
};
const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 10_000) / 100 : 0);

export async function masterDataSummary() {
  const loaded = await Promise.all(ENTRIES.map(async (e) => ({ entry: e, rows: await e.load() })));
  const overview = loaded.map(({ entry, rows }) => {
    const active = rows.filter((r) => r.status?.toLowerCase() === 'active').length;
    const inactive = rows.filter((r) => r.status?.toLowerCase() === 'inactive').length;
    // Seasons may also be Completed: past seasons, counted in the total but not as inactive.
    const completed = rows.filter((r) => r.status?.toLowerCase() === 'completed').length;
    const latest = rows.reduce<Date | null>(
      (max, r) => (!max || r.updatedAt > max ? r.updatedAt : max),
      null,
    );
    return {
      id: entry.id,
      name: entry.name,
      total: rows.length,
      active,
      inactive,
      ...(entry.id === 'season' ? { completed } : {}),
      lastUpdated: latest ? stamp(latest) : null,
      icon: entry.icon,
      path: entry.path,
    };
  });
  const summaryCards = overview.flatMap((o) => {
    const title = ENTRIES.find((e) => e.id === o.id)?.title;
    return title ? [{ id: o.id, title, total: o.total, active: o.active, icon: o.icon }] : [];
  });

  const recent = loaded
    .flatMap(({ entry, rows }) => rows.map((r) => ({ entry, row: r })))
    .sort((a, b) => b.row.createdAt.getTime() - a.row.createdAt.getTime())
    .slice(0, 5);
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(recent.map((r) => r.row.createdBy))] } },
    select: { id: true, name: true },
  });
  const recentlyAdded = recent.map(({ entry, row }, i) => ({
    id: i + 1,
    masterData: entry.name,
    name: row.name,
    addedOn: ddmmyyyy(row.createdAt),
    addedBy: users.find((u) => u.id === row.createdBy)?.name ?? null,
    icon: entry.icon,
    path: entry.path,
  }));

  const total = overview.reduce((sum, o) => sum + o.total, 0);
  const active = overview.reduce((sum, o) => sum + o.active, 0);
  const inactive = overview.reduce((sum, o) => sum + o.inactive, 0);
  const healthy = percent(inactive, total) <= HEALTHY_INACTIVE_PERCENT;
  return {
    summaryCards,
    masterDataOverview: overview,
    recentlyAdded,
    masterDataHealth: {
      total,
      active,
      inactive,
      percentages: {
        active: percent(active, total),
        inactive: percent(inactive, total),
        total: total ? 100 : 0,
      },
      status: healthy ? 'healthy' : 'attention',
      message: healthy
        ? { title: 'All Good!', description: 'Your master data is up to date and looks healthy.' }
        : {
            title: 'Needs Attention',
            description: `${inactive} of ${total} master data records are inactive. Review them.`,
          },
    },
  };
}

export const masterDataRouter = Router();
masterDataRouter.get('/summary', async (_req, res) => {
  res.json(await masterDataSummary());
});
docsPaths['/master-data/summary'] = {
  get: {
    tags: ['Master data'],
    summary: 'Master Data Dashboard: summaryCards, masterDataOverview, recentlyAdded, masterDataHealth',
    responses: { '200': { description: 'Shaped like masterDataDashboardData.js' } },
  },
};
