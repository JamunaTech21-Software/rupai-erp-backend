import type { RequestHandler } from 'express';

import { config } from '../config/env.js';
import { unauthenticated } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { findActiveUser, type PublicUser } from '../modules/auth/service.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** The signed-in user; set by `requireAuth`. */
    user?: PublicUser;
  }
}

/** Every /api/v1 route after login needs `Authorization: Bearer <accessToken>`. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const claims = token ? verifyAccessToken(token, config.JWT_SECRET) : undefined;
  if (!claims) {
    next(unauthenticated());
    return;
  }
  findActiveUser(claims.sub)
    .then((user) => {
      if (!user) throw unauthenticated();
      req.user = user;
      next();
    })
    .catch(next);
};
