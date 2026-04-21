import 'dotenv/config';
import { z } from 'zod';

import { DEFAULT_TIMEZONE } from './domain/constants.js';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().default('change_me'),
  APP_BASE_URL: z.string().url().optional(),
  BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
  DEFAULT_TIMEZONE: z.string().default(DEFAULT_TIMEZONE),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  RAILWAY_TRIAL_END_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  RAILWAY_BALANCE_REMAINING: z.string().optional(),
  RAILWAY_TRIAL_REMINDER_DAYS: z
    .string()
    .default('15,2,1')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => parseInt(entry.trim(), 10))
        .filter((entry) => Number.isInteger(entry) && entry >= 0),
    ),
  BOT_TEST_MESSAGE_PREFIX: z.string().optional(),
});

export const config = envSchema.parse(process.env);
