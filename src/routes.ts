import { Router } from 'express';

import { optionsRouter } from './lib/resource.js';
import { requireAuth } from './middleware/auth.js';
import { approvalSettingsRouter, approvalsRouter } from './modules/approval/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { divisionsRouter, sectionsRouter } from './modules/estate/divisions.js';
import { estatesRouter } from './modules/estate/estates.js';
import { fieldsRouter } from './modules/estate/fields.js';
import { landDocumentsRouter, landPaymentsRouter, landRecordsRouter } from './modules/estate/land.js';
import { mapRouter } from './modules/estate/map.js';
import { mouzasRouter } from './modules/estate/mouzas.js';
import { contractorExtrasRouter, contractorsRouter } from './modules/hr/contractors.js';
import { employeeExtrasRouter, employeesRouter } from './modules/hr/employees.js';
import { workerImportRouter } from './modules/hr/workerImport.js';
import { workerExtrasRouter, workersRouter } from './modules/hr/workers.js';
import { auctionCenterExtrasRouter, auctionCentersRouter } from './modules/master/auctionCenters.js';
import { seasonExtrasRouter, seasonsRouter } from './modules/master/seasons.js';
import { teaGradeExtrasRouter, teaGradesRouter } from './modules/master/teaGrades.js';
import { teaTypeExtrasRouter, teaTypesRouter } from './modules/master/teaTypes.js';
import { teaWarehouseExtrasRouter, teaWarehousesRouter } from './modules/master/teaWarehouses.js';
import { bushRegisterRouter, bushRowsRouter } from './modules/plantation/bushRegister.js';
import { censusesRouter, censusReportRouter, censusRowsRouter } from './modules/plantation/censuses.js';
import { nurseriesRouter, nurseryPanelsRouter } from './modules/plantation/nurseries.js';
import { plantingsRouter } from './modules/plantation/plantings.js';
import { replantingRouter, replantingStepsRouter } from './modules/plantation/replanting.js';
import { filesRouter, sendFileContent } from './modules/files/routes.js';

/** Everything under /api/v1. Each RP1 story mounts its router here. */
export const api = Router();

// Public: sign in and renew the token.
api.use('/auth', authRouter);

// A file's content, for <img src>: needs the signed link from the upload answer, not a token (RP1-10).
api.get('/files/:id/content', sendFileContent);

// Everything below needs a signed-in user (RP1-8).
api.use(requireAuth);

api.use('/files', filesRouter);

// RP1-A Estate Management
api.use('/estates', estatesRouter);
api.use('/divisions', divisionsRouter);
api.use('/sections', sectionsRouter);
api.use('/fields', fieldsRouter);
api.use('/map', mapRouter);
api.use('/mouzas', mouzasRouter);
api.use('/land-records', landRecordsRouter);
api.use('/land-payments', landPaymentsRouter);
api.use('/land-documents', landDocumentsRouter);

// RP1-B Plantation Management
api.use('/nurseries', nurseryPanelsRouter, nurseriesRouter);
api.use('/field-plantings', plantingsRouter);
api.use('/replanting-projects', replantingStepsRouter, replantingRouter);
api.use('/plant-censuses', censusReportRouter, censusRowsRouter, censusesRouter);
api.use('/bush-registers', bushRowsRouter, bushRegisterRouter);
api.use('/employees', employeeExtrasRouter, employeesRouter);
api.use('/workers', workerImportRouter, workerExtrasRouter, workersRouter);
api.use('/contractors', contractorExtrasRouter, contractorsRouter);

// RP1-K Master Data
api.use('/seasons', seasonExtrasRouter, seasonsRouter);
api.use('/tea-types', teaTypeExtrasRouter, teaTypesRouter);
api.use('/tea-grades', teaGradeExtrasRouter, teaGradesRouter);
api.use('/tea-warehouses', teaWarehouseExtrasRouter, teaWarehousesRouter);
api.use('/auction-centers', auctionCenterExtrasRouter, auctionCentersRouter);

// RP1-I Approval
api.use('/approvals', approvalsRouter);
api.use('/approval-settings', approvalSettingsRouter);

// Dropdowns that pick another record (plan.md §3): /options/estates, /options/divisions?estate=, …
api.use('/options', optionsRouter);
