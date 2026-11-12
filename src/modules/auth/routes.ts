import { Router } from 'express';
import { z } from '../../lib/validation.js';

import { requireAuth } from '../../middleware/auth.js';
import { login, logout, refresh, setPhoto } from './service.js';
import { zodFields } from '../../middleware/error-handler.js';
import { AppError } from '../../lib/errors.js';

const LoginBody = z.object({
  username: z
    .string({ error: 'Enter your username or email.' })
    .trim()
    .min(1, 'Enter your username or email.'),
  password: z.string({ error: 'Enter your password.' }).min(1, 'Enter your password.'),
});
const RefreshBody = z.object({ refreshToken: z.string().min(1, 'Refresh token is required.') });
const PhotoBody = z.object({
  photo: z
    .string({ error: 'Upload a photo, or send null to remove it.' })
    .trim()
    .length(26, 'Upload the photo again.')
    .nullable(),
});

/** RP1-8: login, refresh, logout, me (plan.md §3). */
export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const body = LoginBody.parse(req.body);
  res.json(await login(body.username, body.password));
});

authRouter.post('/refresh', async (req, res) => {
  const body = RefreshBody.parse(req.body);
  res.json(await refresh(body.refreshToken));
});

authRouter.post('/logout', async (req, res) => {
  const body = RefreshBody.parse(req.body);
  await logout(body.refreshToken);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/** RP1-173: the signed-in user's own photo: `{ photo: fileId }` sets it, `{ photo: null }` removes it. */
authRouter.put('/me/photo', requireAuth, async (req, res) => {
  const parsed = PhotoBody.safeParse(req.body ?? {});
  if (!parsed.success)
    throw new AppError('VALIDATION', 'Please correct the highlighted fields.', zodFields(parsed.error));
  const user = await setPhoto(req.user?.id ?? '', parsed.data.photo);
  res.json({ user });
});
