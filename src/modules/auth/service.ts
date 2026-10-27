import { createHash, randomBytes } from 'node:crypto';

import { hash, verify } from '@node-rs/argon2';

import { config } from '../../config/env.js';
import { db } from '../../lib/db.js';
import { unauthenticated } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { signAccessToken } from '../../lib/jwt.js';

export interface PublicUser {
  id: string;
  name: string;
  username: string;
  email: string | null;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

const WRONG_LOGIN = 'Wrong username or password.';

export const hashPassword = (password: string) => hash(password);

export const toPublicUser = (u: PublicUser): PublicUser => ({
  id: u.id,
  name: u.name,
  username: u.username,
  email: u.email,
});

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function issueTokens(userId: string): Promise<Tokens> {
  const refreshToken = randomBytes(32).toString('base64url');
  await db.refreshToken.create({
    data: {
      id: newId(),
      userId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    },
  });
  return {
    accessToken: signAccessToken(userId, config.JWT_SECRET, config.ACCESS_TOKEN_TTL_MINUTES * 60),
    refreshToken,
  };
}

/** Username or email + password. Every failure gives the same answer, so it does not reveal which was wrong. */
export async function login(username: string, password: string): Promise<Tokens & { user: PublicUser }> {
  const login = username.trim();
  const user = await db.user.findFirst({ where: { OR: [{ username: login }, { email: login }] } });
  if (!user || user.status !== 'active' || !(await verify(user.passwordHash, password)))
    throw unauthenticated(WRONG_LOGIN);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { ...(await issueTokens(user.id)), user: toPublicUser(user) };
}

/** A valid refresh token is used up and replaced (rotation). */
export async function refresh(refreshToken: string): Promise<Tokens> {
  const row = await db.refreshToken.findUnique({
    where: { tokenHash: sha256(refreshToken) },
    include: { user: true },
  });
  if (!row || row.revokedAt || row.expiresAt <= new Date() || row.user.status !== 'active')
    throw unauthenticated('Your session has ended. Please sign in again.');
  await db.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  return issueTokens(row.userId);
}

export async function logout(refreshToken: string): Promise<void> {
  await db.refreshToken.updateMany({
    where: { tokenHash: sha256(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function findActiveUser(id: string): Promise<PublicUser | undefined> {
  const user = await db.user.findUnique({ where: { id } });
  return user && user.status === 'active' ? toPublicUser(user) : undefined;
}
