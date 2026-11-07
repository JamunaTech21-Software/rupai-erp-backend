/**
 * Manual seed (RP1-11): `npm run seed`, or in Docker `docker compose exec api npm run seed`.
 * Never runs automatically. Safe to run again. Each RP1 story adds its sample data here.
 */
import { db } from '../../src/lib/db.js';
import { logger } from '../../src/lib/logger.js';
import { seedApprovalRequests, seedApprovalSettings } from './approvals.js';
import { seedAuctionCenters } from './auctionCenters.js';
import { seedBushRegister } from './bushRegister.js';
import { seedCensuses } from './censuses.js';
import { seedContractors } from './contractors.js';
import { seedDivisions } from './divisions.js';
import { seedEmployees } from './employees.js';
import { seedEstates } from './estates.js';
import { seedFields } from './fields.js';
import { seedLand } from './land.js';
import { seedMouzas } from './mouzas.js';
import { seedLocations } from './locations.js';
import { seedMap } from './map.js';
import { seedNurseries } from './nurseries.js';
import { seedPlantings } from './plantings.js';
import { seedSeasons } from './seasons.js';
import { seedReplanting } from './replanting.js';
import { seedTeaGrades } from './teaGrades.js';
import { seedTeaTypes } from './teaTypes.js';
import { seedTeaWarehouses } from './teaWarehouses.js';
import { seedWorkers } from './workers.js';
import { ADMIN, seedUsers } from './users.js';

async function main() {
  const adminId = await seedUsers(db);
  const estates = await seedEstates(db, adminId);
  const { divisions, sections } = await seedDivisions(db, adminId, estates);
  const fields = await seedFields(db, adminId, estates, divisions, sections);
  const maps = await seedMap(db, adminId, estates, sections);
  const mouzas = await seedMouzas(db, adminId, estates);
  const land = await seedLand(db, adminId, estates, mouzas);
  const nurseries = await seedNurseries(db, adminId, estates, divisions);
  const plantings = await seedPlantings(db, adminId, fields);
  const replanting = await seedReplanting(db, adminId, fields);
  const censuses = await seedCensuses(db, adminId, fields);
  const bushRegisters = await seedBushRegister(db, adminId, fields);
  const employees = await seedEmployees(db, adminId);
  const workers = await seedWorkers(db, adminId);
  const contractors = await seedContractors(db, adminId);
  const seasons = await seedSeasons(db, adminId);
  const teaTypes = await seedTeaTypes(db, adminId);
  const teaGrades = await seedTeaGrades(db, adminId);
  const warehouses = await seedTeaWarehouses(db, adminId);
  const auctionCenters = await seedAuctionCenters(db, adminId);
  const located = await seedLocations(db);
  const approvalOn = await seedApprovalSettings(db, adminId);
  const requests = await seedApprovalRequests(db, adminId);
  logger.info(
    `Seed: ${Object.keys(estates).length} estates, ${Object.keys(divisions).length} divisions, ${Object.keys(sections).length} sections, ${Object.keys(fields).length} fields, ${maps} estate map, ${Object.keys(mouzas).length} mouzas, ${land.lands} land records, ${land.payments} payments, ${land.documents} documents, ${nurseries} nurseries, ${plantings} field plantings, ${replanting} replanting projects, ${censuses} plant censuses, ${bushRegisters} bush registers, ${employees} employees, ${workers} workers, ${contractors} contractors, ${seasons} seasons, ${teaTypes} tea types, ${teaGrades} tea grades, ${warehouses} tea warehouses, ${auctionCenters} auction centers, ${located} map points / managers filled, approval On for ${approvalOn} modules, ${requests} sample approval requests`,
  );
  logger.info(`Seed: login ${ADMIN.username} / ${ADMIN.password}`);
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, 'Seed failed');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
