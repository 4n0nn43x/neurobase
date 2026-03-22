/**
 * Logger utility using Pino
 * Supports correlation IDs and OpenTelemetry trace context
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
  // Structured JSON in production
  ...(process.env.NODE_ENV === 'production' ? {
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  } : {}),
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

/**
 * Create a logger with a correlation ID attached to every log entry
 */
export function createCorrelatedLogger(correlationId: string) {
  return {
    debug: (obj: any, msg?: string) => logger.debug({ ...obj, correlationId }, msg),
    info: (obj: any, msg?: string) => logger.info({ ...obj, correlationId }, msg),
    warn: (obj: any, msg?: string) => logger.warn({ ...obj, correlationId }, msg),
    error: (obj: any, msg?: string) => logger.error({ ...obj, correlationId }, msg),
  };
}

export default logger;
