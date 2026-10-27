import { pino } from 'pino';

import { config } from '../config/env.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: ['req.headers.authorization', 'password', '*.password', 'refreshToken', '*.refreshToken'],
  ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
});
