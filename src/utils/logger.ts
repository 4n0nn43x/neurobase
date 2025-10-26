/**
 * Logger utility using Pino
 */

import pino from 'pino';

const baseLogger = pino({
  level: process.env.NEUROBASE_LOG_LEVEL || 'info',
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

// Wrapper that checks NEUROBASE_QUIET mode
export const logger = {
  debug: (obj: any, msg?: string) => baseLogger.debug(obj, msg),
  info: (obj: any, msg?: string) => {
    if (process.env.NEUROBASE_QUIET !== 'true') {
      baseLogger.info(obj, msg);
    }
  },
  warn: (obj: any, msg?: string) => {
    if (process.env.NEUROBASE_QUIET !== 'true') {
      baseLogger.warn(obj, msg);
    }
  },
  error: (obj: any, msg?: string) => baseLogger.error(obj, msg),
};

export default logger;
