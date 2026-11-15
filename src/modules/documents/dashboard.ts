import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { pendingBadges, requestNo } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { toJson } from '../../lib/serialize.js';
import { daysLeft, daysLeftLevel, statusWhere, today } from './status.js';

/**
 * RP1-178 N.6 Document Dashboard (`/documents-dashboard`, image 1; image 6 opens Add New Document over it).
 * `GET /documents/dashboard` answers every part of the page that comes from saved data:
 * - cards: Total Documents, Active, Expiring Soon, Expired (the register's statuses, see `status.ts`) and
 *   Pending Approval (every open request of the approval module `documents`, as Quick Actions' "Approval
 *   Requests (6)").
 * - documentsByCategory: the donut. The first 6 categories in display order, the rest as "Other Categories".
 * - expiryStatus: the bars. Active documents by expiry month, this month and the next 11; the first bar
 *   counts from today.
 * - documentCategories: the tiles. The first 9 categories in display order, the rest as "Other (n Categories)".
 * - expiringDocuments: the 5 soonest Expiring Soon documents (the register's Expiring Soon filter, so the card,
 *   the table and "View All" agree).
 * - recentDocuments: the 5 newest documents, with requests to add one still waiting for approval; Approved,
 *   or Pending while a request is open.
 * Documents belong to the company, so the header's estate and season do not filter them. Quick Actions are
 * links on the page.
 */
const DONUT_SLICES = 6;
const CATEGORY_TILES = 9;
const TABLE_ROWS = 5;
const MONTHS = 12;
const live = { deletedAt: null };
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

type CategoryCount = { id: string; categoryCode: string; categoryName: string; totalDocuments: number };

/** The first `keep` categories, then one "Other" entry for the rest (none when nothing is left over). */
function firstAndOther(
  categories: CategoryCount[],
  keep: number,
  otherName: (n: number) => string,
  total: number,
) {
  const shown = categories.slice(0, keep).map((c) => ({
    ...c,
    label: c.categoryName,
    other: false,
    categoryCount: 1,
    percent: percent(c.totalDocuments, total),
  }));
  const rest = categories.slice(keep);
  if (!rest.length) return shown;
  const sum = rest.reduce((s, c) => s + c.totalDocuments, 0);
  return [
    ...shown,
    {
      id: null,
      categoryCode: null,
      categoryName: otherName(rest.length),
      label: otherName(rest.length),
      other: true,
      categoryCount: rest.length,
      categoryIds: rest.map((c) => c.id),
      totalDocuments: sum,
      percent: percent(sum, total),
    },
  ];
}

export async function documentDashboard(now = new Date()) {
  const on = today(now);
  const count = (status: string) => db.document.count({ where: { AND: [live, statusWhere(status, on)] } });
  const firstMonth = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), 1));
  const afterLast = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth() + MONTHS, 1));

  const [total, active, expiringSoon, expired, inactive, pendingApproval, categories, groups, expiries] =
    await Promise.all([
      db.document.count({ where: live }),
      count('ACTIVE'),
      count('EXPIRING_SOON'),
      count('EXPIRED'),
      count('INACTIVE'),
      db.changeRequest.count({ where: { module: 'documents', status: 'pending' } }),
      db.documentCategory.findMany({
        where: live,
        orderBy: [{ displayOrder: 'asc' }, { categoryName: 'asc' }, { id: 'asc' }],
        select: { id: true, categoryCode: true, categoryName: true },
      }),
      db.document.groupBy({ by: ['category'], where: live, _count: { _all: true } }),
      db.document.findMany({
        where: { ...live, isActive: true, expiryDate: { gte: on, lt: afterLast } },
        select: { expiryDate: true },
      }),
    ]);

  const perCategory = new Map(groups.map((g) => [g.category, g._count._all]));
  const counted: CategoryCount[] = categories.map((c) => ({
    ...c,
    totalDocuments: perCategory.get(c.id) ?? 0,
  }));

  const months = Array.from({ length: MONTHS }, (_, i) => {
    const d = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + i, 1));
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return { month, label: `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`, count: 0 };
  });
  for (const { expiryDate } of expiries) {
    if (!expiryDate) continue;
    const i =
      (expiryDate.getUTCFullYear() - firstMonth.getUTCFullYear()) * 12 +
      expiryDate.getUTCMonth() -
      firstMonth.getUTCMonth();
    const bucket = months[i];
    if (bucket) bucket.count += 1;
  }

  const [expiringDocuments, recentDocuments] = await Promise.all([expiringRows(on), recentRows()]);

  return {
    cards: { totalDocuments: total, active, expiringSoon, expired, inactive, pendingApproval },
    documentsByCategory: {
      totalDocuments: total,
      items: firstAndOther(counted, DONUT_SLICES, () => 'Other Categories', total),
    },
    expiryStatus: { from: on, months },
    documentCategories: {
      totalCategories: categories.length,
      items: firstAndOther(
        counted,
        CATEGORY_TILES,
        (n) => `Other (${n} ${n === 1 ? 'Category' : 'Categories'})`,
        total,
      ),
    },
    expiringDocuments,
    recentDocuments,
  };
}

async function expiringRows(on: Date) {
  const where = { AND: [live, statusWhere('EXPIRING_SOON', on)] };
  const rows = await db.document.findMany({
    where,
    orderBy: [{ expiryDate: 'asc' }, { documentNo: 'asc' }, { id: 'asc' }],
    take: TABLE_ROWS,
    select: {
      id: true,
      documentName: true,
      documentNo: true,
      expiryDate: true,
      category: true,
      categoryRef: { select: { categoryName: true } },
    },
  });
  return rows.map(({ categoryRef, ...r }) => {
    const left = daysLeft(r.expiryDate, on);
    return {
      ...r,
      categoryName: categoryRef.categoryName,
      daysLeft: left,
      daysLeftLabel: left === null ? null : plural(left, 'day'),
      daysLeftLevel: daysLeftLevel(left),
    };
  });
}

type RecentRow = {
  id: string | null;
  requestId: string | null;
  requestNo: string | null;
  documentName: string;
  documentNo: string;
  category: string | null;
  categoryName: string | null;
  uploadedOn: Date;
  status: 'APPROVED' | 'PENDING';
  statusLabel: string;
};

async function recentRows(): Promise<RecentRow[]> {
  const [docs, creates] = await Promise.all([
    db.document.findMany({
      where: live,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: TABLE_ROWS,
      select: {
        id: true,
        documentName: true,
        documentNo: true,
        category: true,
        createdAt: true,
        categoryRef: { select: { categoryName: true } },
      },
    }),
    db.changeRequest.findMany({
      where: { resource: 'document', action: 'create', status: 'pending' },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: TABLE_ROWS,
      select: { id: true, seq: true, newData: true, requestedAt: true },
    }),
  ]);
  const badges = await pendingBadges(
    'document',
    docs.map((d) => d.id),
  );
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const asked = creates.map((r) => ({ ...r, data: (r.newData ?? {}) as Record<string, unknown> }));
  const askedCategories = [...new Set(asked.map((r) => str(r.data.category)).filter(Boolean))];
  const names = new Map(
    (
      await db.documentCategory.findMany({
        where: { id: { in: askedCategories } },
        select: { id: true, categoryName: true },
      })
    ).map((c) => [c.id, c.categoryName]),
  );

  const rows: RecentRow[] = [
    ...docs.map(({ categoryRef, createdAt, ...d }) => {
      const badge = badges.get(d.id) ?? null;
      return {
        ...d,
        categoryName: categoryRef.categoryName,
        requestId: badge?.id ?? null,
        requestNo: badge?.requestNo ?? null,
        uploadedOn: createdAt,
        status: badge ? ('PENDING' as const) : ('APPROVED' as const),
        statusLabel: badge ? 'Pending' : 'Approved',
      };
    }),
    ...asked.map((r) => {
      const category = typeof r.data.category === 'string' ? r.data.category : null;
      return {
        id: null,
        requestId: r.id,
        requestNo: requestNo(r.seq),
        documentName: str(r.data.documentName),
        documentNo: str(r.data.documentNo),
        category,
        categoryName: category ? (names.get(category) ?? null) : null,
        uploadedOn: r.requestedAt,
        status: 'PENDING' as const,
        statusLabel: 'Pending',
      };
    }),
  ];
  return rows.sort((a, b) => b.uploadedOn.getTime() - a.uploadedOn.getTime()).slice(0, TABLE_ROWS);
}

export const documentDashboardRouter = Router();
documentDashboardRouter.get('/dashboard', async (_req, res) => {
  res.json(toJson(await documentDashboard()));
});
docsPaths['/documents/dashboard'] = {
  get: {
    tags: ['Document'],
    summary:
      'Document Dashboard (image 1): cards, documentsByCategory, expiryStatus (12 months), documentCategories, expiringDocuments, recentDocuments',
    responses: { '200': { description: 'The dashboard' } },
  },
};
