import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { oneOf, optText, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';

/**
 * RP1-185 P.2 Regulatory Authority Setup (`/master-data-regulatory-authority`, no design image: the same layout
 * as the other Master Data setup pages). The authorities that regulate auction centers (Auction Center
 * "Regulatory Authority"), which was a fixed list in code. Fields: Authority Code, Authority Name, Short Name,
 * Status. The list shows how many auction centers use each. An authority in use cannot be deleted; an
 * Inactive one is not offered for new choices.
 */
const STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];
const labelOf = (value: unknown) => STATUSES.find((o) => o.value === value)?.label ?? null;
const live = { deletedAt: null };

const authoritySchema = z.object({
  authorityCode: text(20)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, - or _ only (for example BTB).')
    .transform((v) => v.toUpperCase()),
  authorityName: text(160),
  shortName: optText(50),
  status: oneOf(STATUSES.map((o) => o.value)),
});

/** Live auction centers per authority. */
async function centerCounts(ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const groups = await db.auctionCenter.groupBy({
    by: ['regulatoryAuthority'],
    where: { ...live, regulatoryAuthority: { in: ids } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.regulatoryAuthority, g._count._all]));
}

export const regulatoryAuthoritiesRouter = defineResource('/regulatory-authorities', {
  name: 'regulatoryAuthority',
  label: 'Regulatory authority',
  module: 'master',
  page: 'Regulatory Authority Setup',
  describe: (r) => show(r.authorityCode, paren(r.authorityName)),
  model: 'regulatoryAuthority',
  schema: authoritySchema,
  search: ['authorityCode', 'authorityName', 'shortName'],
  filters: ['status'],
  unique: ['authorityCode', 'authorityName'],
  orderBy: [{ authorityCode: 'asc' }, { id: 'asc' }],
  extend: (row) => ({ statusLabel: labelOf(row.status) }),
  deleteCheck: async (row) => {
    const used = (await centerCounts([row.id])).get(row.id) ?? 0;
    return used
      ? `This regulatory authority is used by ${used} auction center${used === 1 ? '' : 's'}.`
      : undefined;
  },
  /** Used By column: Auction Centers. */
  enrich: async (rows) => {
    const counts = await centerCounts(rows.map((r) => r.id));
    return new Map(rows.map((r) => [r.id, { totalAuctionCenters: counts.get(r.id) ?? 0 }]));
  },
  summary: async (where) => {
    const groups = await db.regulatoryAuthority.groupBy({ by: ['status'], where, _count: { _all: true } });
    const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
    return {
      totalAuthorities: groups.reduce((sum, g) => sum + g._count._all, 0),
      active: count('ACTIVE'),
      inactive: count('INACTIVE'),
    };
  },
  export: {
    fileName: 'regulatory-authorities',
    sheet: 'Regulatory Authorities',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Authority Code', value: (row) => row.authorityCode, width: 16 },
      { header: 'Authority Name', value: (row) => row.authorityName, width: 50 },
      { header: 'Short Name', value: (row) => row.shortName, width: 20 },
      { header: 'Auction Centers', value: (row) => row.totalAuctionCenters, width: 16 },
      { header: 'Status', value: (row) => row.statusLabel, width: 10 },
    ],
  },
  options: { path: 'regulatory-authorities', label: (row) => String(row.authorityName), filters: ['status'] },
});

/** The page's Status filter and the form's Status dropdown. */
export const regulatoryAuthorityExtrasRouter = Router();
regulatoryAuthorityExtrasRouter.get('/filter-options', (_req, res) => {
  res.json({ statuses: STATUSES.map((o, i) => ({ id: i + 1, ...o })) });
});
docsPaths['/regulatory-authorities/filter-options'] = {
  get: {
    tags: ['Regulatory authority'],
    summary: 'Regulatory Authority Setup filter and form options: statuses',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};

/**
 * The authorities for a form's dropdown, as `{ id, value, label }` (value = the authority's id): the Active
 * ones, in code order. Auction Centers' `regulatoryAuthorities` filter options.
 */
export async function regulatoryAuthorityChoices() {
  const rows = await db.regulatoryAuthority.findMany({
    where: { ...live, status: 'ACTIVE' },
    orderBy: [{ authorityCode: 'asc' }, { id: 'asc' }],
    select: { id: true, authorityCode: true, authorityName: true, shortName: true },
  });
  return rows.map((r, i) => ({
    id: i + 1,
    value: r.id,
    label: r.authorityName,
    code: r.authorityCode,
    shortName: r.shortName,
  }));
}

/**
 * A picked authority must be Active, unless the center already had it (an edit may keep one that has since
 * been set Inactive). Answers the field's message, or nothing.
 */
export async function inactiveAuthority(picked: unknown, saved: unknown) {
  if (typeof picked !== 'string' || picked === saved) return undefined;
  const row = await db.regulatoryAuthority.findFirst({
    where: { id: picked, ...live },
    select: { status: true },
  });
  return row && row.status !== 'ACTIVE' ? 'This regulatory authority is Inactive.' : undefined;
}
