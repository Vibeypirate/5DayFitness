import express from 'express';

import { config } from './config.js';
import { createWebhookHandler } from './bot/create-bot.js';
import type { Bot } from 'grammy';

export function createServer(bot: Bot) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post(`/telegram/webhook/${config.TELEGRAM_WEBHOOK_SECRET}`, createWebhookHandler(bot));

  return app;
}
