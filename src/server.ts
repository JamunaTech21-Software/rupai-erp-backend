import { createApp } from './app.js';
import { config } from './config/env.js';
import { db } from './lib/db.js';
import { logger } from './lib/logger.js';

const server = createApp().listen(config.PORT, () => {
  logger.info(`RupAI backend listening on http://localhost:${config.PORT}`);
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    void db.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
