/**
 * Manual seed (RP1-11): `npm run seed`, or in Docker `docker compose exec api npm run seed`.
 * Never runs automatically. Safe to run again. Each RP1 story adds its sample data here.
 */
import { db } from '../../src/lib/db.js';
import { logger } from '../../src/lib/logger.js';
import { seedDivisions } from './divisions.js';
import { seedEstates } from './estates.js';
import { seedFields } from './fields.js';
import { seedLand } from './land.js';
import { seedMap } from './map.js';
import { ADMIN, seedUsers } from './users.js';

async function main() {
  const adminId = await seedUsers(db);
  const estates = await seedEstates(db, adminId);
  const { divisions, sections } = await seedDivisions(db, adminId, estates);
  const fields = await seedFields(db, adminId, estates, divisions, sections);
  const maps = await seedMap(db, adminId, estates, sections);
  const land = await seedLand(db, adminId, estates);
  logger.info(
    `Seed: ${Object.keys(estates).length} estates, ${Object.keys(divisions).length} divisions, ${Object.keys(sections).length} sections, ${Object.keys(fields).length} fields, ${maps} estate map, ${land.lands} land records, ${land.payments} payments, ${land.documents} documents`,
  );
  logger.info(`Seed: login ${ADMIN.username} / ${ADMIN.password}`);
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, 'Seed failed');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
