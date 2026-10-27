import { Router } from 'express';
import { z } from '../../lib/validation.js';

import { requireAuth } from '../../middleware/auth.js';
import { login, logout, refresh } from './service.js';

const LoginBody = z.object({
  username: z
    .string({ error: 'Enter your username or email.' })
    .trim()
    .min(1, 'Enter your username or email.'),
  password: z.string({ error: 'Enter your password.' }).min(1, 'Enter your password.'),
});
const RefreshBody = z.object({ refreshToken: z.string().min(1, 'Refresh token is required.') });

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
