import { existsSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

// The Prisma CLI does not read .env on its own. Real environment variables always win.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Optional at load time so that `prisma generate` works without a database.
    url: process.env.DATABASE_URL ?? '',
    ...(process.env.SHADOW_DATABASE_URL ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL } : {}),
  },
});
