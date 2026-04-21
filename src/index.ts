import type { Server } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

import { createBot } from './bot/create-bot.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { startScheduler } from './scheduler.js';
import { createServer } from './server.js';
import { GrammyError } from 'grammy';

async function registerWebhook(bot: ReturnType<typeof createBot>, maxAttempts = 5) {
  const webhookUrl = `${config.APP_BASE_URL}/telegram/webhook/${config.TELEGRAM_WEBHOOK_SECRET}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await bot.api.setWebhook(webhookUrl);
      logger.info({ webhookUrl, attempt }, 'Telegram webhook registered');
      return;
    } catch (error) {
      const retryAfterSeconds =
        error instanceof GrammyError && error.error_code === 429
          ? (error.parameters?.retry_after ?? 1)
          : attempt;

      logger.warn(
        { error, attempt, retryAfterSeconds, webhookUrl },
        'Telegram webhook registration failed',
      );

      if (attempt === maxAttempts) {
        logger.error({ webhookUrl, attempts: maxAttempts }, 'Telegram webhook registration exhausted retries');
        return;
      }

      await delay(retryAfterSeconds * 1000);
    }
  }
}

async function main() {
  await prisma.$connect();

  const bot = createBot();
  const scheduler = startScheduler(bot);
  let server: Server | undefined;
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Shutdown started');

    scheduler.stop();

    if (config.BOT_MODE === 'polling') {
      await bot.stop();
    }

    if (server) {
      const currentServer = server;
      await new Promise<void>((resolve, reject) => {
        currentServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    await prisma.$disconnect();
    logger.info({ signal }, 'Shutdown completed');
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT').finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM').finally(() => process.exit(0));
  });

  if (config.BOT_MODE === 'webhook') {
    if (!config.APP_BASE_URL) {
      throw new Error('APP_BASE_URL is required in webhook mode.');
    }

    const app = createServer(bot);
    server = await new Promise<Server>((resolve) => {
      const listeningServer = app.listen(config.PORT, () => {
        logger.info({ port: config.PORT }, 'Webhook server listening');
        resolve(listeningServer);
      });
    });
    void registerWebhook(bot);
    return;
  }

  await bot.start({
    onStart: (info) => {
      logger.info({ username: info.username }, 'Bot started in polling mode');
    },
  });
}

main().catch(async (error) => {
  logger.error({ error }, 'Fatal startup error');
  await prisma.$disconnect();
  process.exit(1);
});
