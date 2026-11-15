import { type Database } from '../../src/lib/db.js';
import { seedOne } from './util.js';

/**
 * RP1-182 sample associations: the old fixed lists of Auction Center "Managed By" and Add New Broker
 * "Association". The migration adds the same three to a database that already has users. Added once (by code).
 */
const ASSOCIATIONS = [
  ['TTAB', 'Tea Traders Association of Bangladesh (TTAB)', 'TTAB'],
  ['STGOTTAB', 'Small Tea Garden Owners & Tea Traders Association of Bangladesh', 'Small Tea Garden'],
  ['OTHER', 'Other Association', 'Other'],
] as const;

export async function seedAssociations(db: Database, userId: string): Promise<number> {
  for (const [associationCode, associationName, shortName] of ASSOCIATIONS)
    await seedOne(
      db,
      userId,
      'association',
      { associationCode },
      { associationCode, associationName, shortName, status: 'ACTIVE' },
    );
  return ASSOCIATIONS.length;
}

/** RP1-185 sample regulatory authority: the old fixed list's one. Added once (by code). */
export async function seedRegulatoryAuthorities(db: Database, userId: string): Promise<number> {
  await seedOne(
    db,
    userId,
    'regulatoryAuthority',
    { authorityCode: 'BTB' },
    { authorityCode: 'BTB', authorityName: 'Bangladesh Tea Board', shortName: 'BTB', status: 'ACTIVE' },
  );
  return 1;
}

/** The seeded Bangladesh Tea Board's id. */
export async function teaBoardId(db: Database): Promise<string> {
  const row = await db.regulatoryAuthority.findFirst({
    where: { authorityCode: 'BTB', deletedAt: null },
    select: { id: true },
  });
  if (!row) throw new Error('Seed: regulatory authority BTB is missing.');
  return row.id;
}

/** A seeded association's id, by code. */
export async function associationId(db: Database, associationCode: string): Promise<string> {
  const row = await db.association.findFirst({
    where: { associationCode, deletedAt: null },
    select: { id: true },
  });
  if (!row) throw new Error(`Seed: association ${associationCode} is missing.`);
  return row.id;
}
