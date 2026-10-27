/**
 * Manual seed (RP1-11): `npm run seed`, or in Docker `docker compose exec api npm run seed`.
 * Never runs automatically. Safe to run again. Each RP1 story adds its sample data here.
 */
import { db } from '../../src/lib/db.js';
import { logger } from '../../src/lib/logger.js';
import { ADMIN, seedUsers } from './users.js';

async function main() {
  await seedUsers(db);
  logger.info(`Seed: login ${ADMIN.username} / ${ADMIN.password}`);
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, 'Seed failed');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
