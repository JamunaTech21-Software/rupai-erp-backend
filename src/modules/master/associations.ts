import { Router } from 'express';

import { docsPaths } from '../../docs/openapi.js';
import { paren, show } from '../../lib/approval.js';
import { db } from '../../lib/db.js';
import { oneOf, optText, text } from '../../lib/fields.js';
import { defineResource } from '../../lib/resource.js';
import { z } from '../../lib/validation.js';
import { contactColumns, contactSchema, contactSearch } from './contactFields.js';

/**
 * RP1-182 P.1 Association Setup (`/master-data-association`, no design image: the same layout as the other
 * Master Data setup pages). The associations that manage auction centers (Auction Center "Managed By"); it
 * was a fixed list in code. Fields: Association Code, Association Name, Short Name, Status; RP1-194 adds Contact
 * Person, Designation, Phone, Email, Website, Address. The list shows how many auction centers use each.
 * An association in use cannot be deleted; an Inactive one is not offered for new choices.
 * RP1-211 P.7: brokers no longer have an association, so they are not counted.
 */
const STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];
const labelOf = (value: unknown) => STATUSES.find((o) => o.value === value)?.label ?? null;
const live = { deletedAt: null };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const associationSchema = z.object({
  associationCode: text(20)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, - or _ only (for example TTAB).')
    .transform((v) => v.toUpperCase()),
  associationName: text(160),
  shortName: optText(50),
  ...contactSchema,
  status: oneOf(STATUSES.map((o) => o.value)),
});

/** Live auction centers per association. */
async function usage(ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const centers = await db.auctionCenter.groupBy({
    by: ['managedBy'],
    where: { ...live, managedBy: { in: ids } },
    _count: { _all: true },
  });
  return new Map(centers.map((g) => [g.managedBy, g._count._all]));
}

export const associationsRouter = defineResource('/associations', {
  name: 'association',
  label: 'Association',
  module: 'master',
  page: 'Association Setup',
  describe: (r) => show(r.associationCode, paren(r.associationName)),
  model: 'association',
  schema: associationSchema,
  search: ['associationCode', 'associationName', 'shortName', ...contactSearch],
  filters: ['status'],
  unique: ['associationCode', 'associationName'],
  orderBy: [{ associationCode: 'asc' }, { id: 'asc' }],
  extend: (row) => ({ statusLabel: labelOf(row.status) }),
  deleteCheck: async (row) => {
    const c = (await usage([row.id])).get(row.id) ?? 0;
    return c ? `This association is used by ${plural(c, 'auction center')}.` : undefined;
  },
  /** Used By column: Auction Centers. */
  enrich: async (rows) => {
    const centers = await usage(rows.map((r) => r.id));
    return new Map(rows.map((r) => [r.id, { totalAuctionCenters: centers.get(r.id) ?? 0 }]));
  },
  summary: async (where) => {
    const groups = await db.association.groupBy({ by: ['status'], where, _count: { _all: true } });
    const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
    return {
      totalAssociations: groups.reduce((sum, g) => sum + g._count._all, 0),
      active: count('ACTIVE'),
      inactive: count('INACTIVE'),
    };
  },
  export: {
    fileName: 'associations',
    sheet: 'Associations',
    columns: [
      { header: 'SL', value: (_row, i) => i + 1, width: 6 },
      { header: 'Association Code', value: (row) => row.associationCode, width: 18 },
      { header: 'Association Name', value: (row) => row.associationName, width: 60 },
      { header: 'Short Name', value: (row) => row.shortName, width: 20 },
      ...contactColumns,
      { header: 'Auction Centers', value: (row) => row.totalAuctionCenters, width: 16 },
      { header: 'Status', value: (row) => row.statusLabel, width: 10 },
    ],
  },
  options: { path: 'associations', label: (row) => String(row.associationName), filters: ['status'] },
});

/** The page's Status filter and the form's Status dropdown. */
export const associationExtrasRouter = Router();
associationExtrasRouter.get('/filter-options', (_req, res) => {
  res.json({ statuses: STATUSES.map((o, i) => ({ id: i + 1, ...o })) });
});
docsPaths['/associations/filter-options'] = {
  get: {
    tags: ['Association'],
    summary: 'Association Setup filter and form options: statuses',
    responses: { '200': { description: '[{ id, value, label }] lists' } },
  },
};

/**
 * The associations for a form's dropdown, as `{ id, value, label }` (value = the association's id): the Active
 * ones, in code order. Auction Centers' `managedBy` filter options.
 */
export async function associationChoices() {
  const rows = await db.association.findMany({
    where: { ...live, status: 'ACTIVE' },
    orderBy: [{ associationCode: 'asc' }, { id: 'asc' }],
    select: { id: true, associationCode: true, associationName: true, shortName: true },
  });
  return rows.map((r, i) => ({
    id: i + 1,
    value: r.id,
    label: r.associationName,
    code: r.associationCode,
    shortName: r.shortName,
  }));
}

/**
 * A picked association must be Active, unless the record already had it (an edit may keep an association that
 * has since been set Inactive). Answers the field's message, or nothing.
 */
export async function inactiveAssociation(picked: unknown, saved: unknown) {
  if (typeof picked !== 'string' || picked === saved) return undefined;
  const row = await db.association.findFirst({ where: { id: picked, ...live }, select: { status: true } });
  return row && row.status !== 'ACTIVE' ? 'This association is Inactive.' : undefined;
}
