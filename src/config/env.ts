import { existsSync } from 'node:fs';

import { z } from 'zod';

// Local runs read .env; Docker passes real environment variables, which always win.
if (existsSync('.env')) process.loadEnvFile('.env');

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().startsWith('mysql://', 'DATABASE_URL must be a mysql:// URL'),
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),
  /** Comma-separated origins allowed to call the API (the dashboard). */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** Signs the access tokens (HS256). At least 32 characters. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  /** Where uploaded files are kept (a Docker volume in compose). */
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  /** The API's own address, for file links (`<field>Url`). */
  PUBLIC_URL: z.string().url().default('http://localhost:4100'),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  return parsed.data;
}

export const config = loadConfig();

export const corsOrigins = config.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
