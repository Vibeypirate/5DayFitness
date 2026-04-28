import express from 'express';

import { config } from './config.js';
import { createWebhookHandler } from './bot/create-bot.js';
import { logger } from './logger.js';
import type { Bot } from 'grammy';

export function createServer(bot: Bot) {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    logger.info({ method: req.method, path: req.path, ip: req.ip }, 'Incoming request');
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post(`/telegram/webhook/${config.TELEGRAM_WEBHOOK_SECRET}`, createWebhookHandler(bot));

  return app;
}
