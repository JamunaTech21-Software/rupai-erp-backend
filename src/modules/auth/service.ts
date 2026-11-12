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
  /** RP1-170: when the session ends (sign-in + SESSION_HOURS); sign in again after it. */
  sessionEndsAt: string;
  /** RP1-170: minutes without use after which the session ends. */
  idleMinutes: number;
}

const SESSION_ENDED = 'Your session has ended. Please sign in again.';
const MINUTE = 60_000;

const WRONG_LOGIN = 'Wrong username or password.';

export const hashPassword = (password: string) => hash(password);

export const toPublicUser = (u: PublicUser): PublicUser => ({
  id: u.id,
  name: u.name,
  username: u.username,
  email: u.email,
});

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * RP1-170: tokens for a session that started at `startedAt` and ends at `endsAt`. A refresh keeps both, so
 * using the app does not make a session last longer; no access token outlives its session.
 */
async function issueTokens(userId: string, startedAt: Date, endsAt: Date, now = new Date()): Promise<Tokens> {
  const refreshToken = randomBytes(32).toString('base64url');
  await db.refreshToken.create({
    data: {
      id: newId(),
      userId,
      tokenHash: sha256(refreshToken),
      startedAt,
      expiresAt: endsAt,
      createdAt: now,
    },
  });
  const ttl = Math.min(
    config.ACCESS_TOKEN_TTL_MINUTES * 60,
    Math.floor((endsAt.getTime() - now.getTime()) / 1000),
  );
  return {
    accessToken: signAccessToken(userId, config.JWT_SECRET, ttl),
    refreshToken,
    sessionEndsAt: endsAt.toISOString(),
    idleMinutes: config.IDLE_MINUTES,
  };
}

/** The end of a session started at `startedAt`, as the settings are now. */
const sessionEnd = (startedAt: Date) => new Date(startedAt.getTime() + config.SESSION_HOURS * 60 * MINUTE);

/**
 * A refresh token not used for the access token's life plus IDLE_MINUTES means nobody used the app for at
 * least IDLE_MINUTES (while the app is in use, it refreshes once each access token runs out).
 */
const idleSince = (issuedAt: Date) =>
  new Date(issuedAt.getTime() + (config.ACCESS_TOKEN_TTL_MINUTES + config.IDLE_MINUTES) * MINUTE);

/** Username or email + password. Every failure gives the same answer, so it does not reveal which was wrong. */
export async function login(username: string, password: string): Promise<Tokens & { user: PublicUser }> {
  const login = username.trim();
  const user = await db.user.findFirst({ where: { OR: [{ username: login }, { email: login }] } });
  if (!user || user.status !== 'active' || !(await verify(user.passwordHash, password)))
    throw unauthenticated(WRONG_LOGIN);
  const now = new Date();
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
  return { ...(await issueTokens(user.id, now, sessionEnd(now), now)), user: toPublicUser(user) };
}

/** A valid refresh token is used up and replaced (rotation). */
export async function refresh(refreshToken: string): Promise<Tokens> {
  const row = await db.refreshToken.findUnique({
    where: { tokenHash: sha256(refreshToken) },
    include: { user: true },
  });
  const now = new Date();
  if (!row || row.revokedAt) throw unauthenticated(SESSION_ENDED);
  // The earlier of the saved end and the end under today's settings (SESSION_HOURS may have been lowered).
  const endsAt = new Date(Math.min(row.expiresAt.getTime(), sessionEnd(row.startedAt).getTime()));
  // Used up either way: an ended session's token cannot be tried again.
  await db.refreshToken.update({ where: { id: row.id }, data: { revokedAt: now } });
  if (endsAt <= now || idleSince(row.createdAt) <= now || row.user.status !== 'active')
    throw unauthenticated(SESSION_ENDED);
  return issueTokens(row.userId, row.startedAt, endsAt, now);
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
