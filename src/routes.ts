import { Router } from 'express';

import { optionsRouter } from './lib/resource.js';
import { requireAuth } from './middleware/auth.js';
import { authRouter } from './modules/auth/routes.js';
import { divisionsRouter, sectionsRouter } from './modules/estate/divisions.js';
import { estatesRouter } from './modules/estate/estates.js';
import { fieldsRouter } from './modules/estate/fields.js';
import { landDocumentsRouter, landPaymentsRouter, landRecordsRouter } from './modules/estate/land.js';
import { mapRouter } from './modules/estate/map.js';
import { mouzasRouter } from './modules/estate/mouzas.js';
import { contractorsRouter } from './modules/hr/contractors.js';
import { employeesRouter } from './modules/hr/employees.js';
import { workerImportRouter } from './modules/hr/workerImport.js';
import { workersRouter } from './modules/hr/workers.js';
import { bushRegisterRouter, bushRowsRouter } from './modules/plantation/bushRegister.js';
import { censusesRouter, censusReportRouter } from './modules/plantation/censuses.js';
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
api.use('/plant-censuses', censusReportRouter, censusesRouter);
api.use('/bush-registers', bushRowsRouter, bushRegisterRouter);
api.use('/employees', employeesRouter);
api.use('/workers', workerImportRouter, workersRouter);
api.use('/contractors', contractorsRouter);

// Dropdowns that pick another record (plan.md §3): /options/estates, /options/divisions?estate=, …
api.use('/options', optionsRouter);
