import { Router } from 'express';

import { optionsRouter } from './lib/resource.js';
import { requireAuth } from './middleware/auth.js';
import { authRouter } from './modules/auth/routes.js';
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

// Dropdowns that pick another record (plan.md §3): /options/estates, /options/divisions?estate=, …
api.use('/options', optionsRouter);
