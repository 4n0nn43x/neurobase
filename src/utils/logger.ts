/**
 * Logger utility using Pino
 */

import pino from 'pino';

const logLevel = process.env.NEUROBASE_LOG_LEVEL || 'info';

export const logger = pino({
  level: logLevel,
  transport:
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

export default logger;
