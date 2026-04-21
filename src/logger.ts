import pino, { type LoggerOptions } from 'pino';

import { config } from './config.js';

const loggerOptions: LoggerOptions = {
  level: config.LOG_LEVEL,
};

if (config.NODE_ENV === 'development') {
  loggerOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  };
}

export const logger = pino(loggerOptions);
