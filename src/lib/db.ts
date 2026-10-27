import { PrismaMariaDb } from '@prisma/adapter-mariadb';

import { config } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

type PoolConfig = Exclude<ConstructorParameters<typeof PrismaMariaDb>[0], string>;

/** Turns a mysql:// URL into driver pool settings; URL-encoded passwords are decoded here. */
export function poolConfigFromUrl(url: string, poolSize: number): PoolConfig {
  const u = new URL(url);
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL must name a database');
  return {
    host: u.hostname,
    port: u.port ? Number.parseInt(u.port, 10) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
    connectionLimit: poolSize,
    allowPublicKeyRetrieval: true,
    // The database stores UTC.
    timezone: 'Z',
    charset: 'utf8mb4',
  };
}

export const db = new PrismaClient({
  adapter: new PrismaMariaDb(poolConfigFromUrl(config.DATABASE_URL, config.DATABASE_POOL_SIZE)),
});

export type Database = typeof db;
