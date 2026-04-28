import cron from 'node-cron';
import { ScheduledJobType } from '@prisma/client';

import { prisma } from './db.js';
import { buildRailwayTrialReminderResult } from './domain/railway-trial.js';
import { localDate } from './domain/time.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { ReminderService } from './services/reminder-service.js';
import { WeeklyRollupService } from './services/weekly-rollup-service.js';
import { WorkoutPhotoReviewService } from './services/workout-photo-review-service.js';
import { WorkoutService } from './services/workout-service.js';
import type { Bot } from 'grammy';

const reminderService = new ReminderService();
const weeklyRollupService = new WeeklyRollupService();
const workoutPhotoReviewService = new WorkoutPhotoReviewService();
const workoutService = new WorkoutService();

export function startScheduler(bot: Bot) {
  let isRunning = false;

  const task = cron.schedule('* * * * *', async () => {
    if (isRunning) {
      logger.warn('Scheduler tick skipped because previous tick is still running');
      return;
    }
    isRunning = true;
    try {
      const now = new Date();
      const groups = await prisma.group.findMany({
        where: { isActive: true },
        include: { settings: true },
      });

      for (const group of groups) {
        if (!group.settings || !group.settings.automationEnabled) {
          continue;
        }

        const localNow = new Intl.DateTimeFormat('en-GB', {
          timeZone: group.settings.timezone,
          hour: '2-digit',
          minute: '2-digit',
          weekday: 'short',
        }).formatToParts(now);
        const time = `${localNow.find((part) => part.type === 'hour')?.value}:${localNow.find((part) => part.type === 'minute')?.value}`;
        const weekday = localNow.find((part) => part.type === 'weekday')?.value;

        if (time === group.settings.reminderTime) {
          const jobKey = `${localDate(now, group.settings.timezone)}-${group.settings.reminderTime}`;
          const message = await reminderService.buildReminder(
            group.id,
            group.settings.timezone,
            group.settings.weeklyTarget,
            now,
          );
          if (message) {
            const created = await reminderService.recordReminder(
              group.id,
              ScheduledJobType.DAILY_REMINDER,
              jobKey,
              now,
              message,
            );
            if (created) {
              try {
                await bot.api.sendMessage(Number(group.telegramChatId), message, { parse_mode: 'Markdown' });
              } catch (sendError) {
                logger.warn({ error: sendError instanceof Error ? sendError.message : String(sendError), groupId: group.id }, 'Failed to send reminder message');
              }
            }
          }
        }

        if (group.settings.lateReminderTime && time === group.settings.lateReminderTime) {
          const jobKey = `${localDate(now, group.settings.timezone)}-${group.settings.lateReminderTime}`;
          const message = await reminderService.buildReminder(
            group.id,
            group.settings.timezone,
            group.settings.weeklyTarget,
            now,
          );
          if (message) {
            const created = await reminderService.recordReminder(
              group.id,
              ScheduledJobType.LATE_REMINDER,
              jobKey,
              now,
              message,
            );
            if (created) {
              try {
                await bot.api.sendMessage(Number(group.telegramChatId), message, { parse_mode: 'Markdown' });
              } catch (sendError) {
                logger.warn({ error: sendError instanceof Error ? sendError.message : String(sendError), groupId: group.id }, 'Failed to send late reminder message');
              }
            }
          }
        }

        if (time === '00:01') {
          const jobKey = `${localDate(now, group.settings.timezone)}-00:01`;
          const message = reminderService.buildNewDayMessage(group.settings.weeklyTarget);
          const created = await reminderService.recordReminder(
            group.id,
            ScheduledJobType.DAILY_RESET,
            jobKey,
            now,
            message,
          );
          if (created) {
            try {
              await bot.api.sendMessage(Number(group.telegramChatId), message, { parse_mode: 'Markdown' });
            } catch (sendError) {
              logger.warn({ error: sendError instanceof Error ? sendError.message : String(sendError), groupId: group.id }, 'Failed to send daily reset message');
            }
          }
        }

        if (time === '09:00' && config.RAILWAY_TRIAL_END_DATE) {
          const reminder = buildRailwayTrialReminderResult({
            now,
            timezone: group.settings.timezone,
            trialEndDate: config.RAILWAY_TRIAL_END_DATE,
            balanceRemaining: config.RAILWAY_BALANCE_REMAINING,
            reminderDays: config.RAILWAY_TRIAL_REMINDER_DAYS,
            testPrefix: config.BOT_TEST_MESSAGE_PREFIX,
          });

          if (reminder) {
            const jobKey = `${localDate(now, group.settings.timezone)}-railway-trial-${reminder.daysLeft}`;
            const created = await reminderService.recordReminder(
              group.id,
              ScheduledJobType.DAILY_REMINDER,
              jobKey,
              now,
              reminder.message,
            );
            if (created) {
              try {
                await bot.api.sendMessage(Number(group.telegramChatId), reminder.message, { parse_mode: 'Markdown' });
              } catch (sendError) {
                logger.warn({ error: sendError instanceof Error ? sendError.message : String(sendError), groupId: group.id }, 'Failed to send trial reminder message');
              }
            }
          }
        }

        if (weekday === 'Sun' && time === '23:59') {
          const summary = await weeklyRollupService.runWeeklySummary(group.id, now);
          if (summary) {
            try {
              await bot.api.sendMessage(Number(group.telegramChatId), summary, { parse_mode: 'Markdown' });
            } catch (sendError) {
              logger.warn({ error: sendError instanceof Error ? sendError.message : String(sendError), groupId: group.id }, 'Failed to send weekly summary');
            }
          }
        }

        if (weekday === 'Mon' && time === '00:00') {
          await weeklyRollupService.resetCurrentWeek(group.id, now);
        }
      }

      const expiryReminders = await workoutService.sendExpiryReminders(now);
      for (const reminder of expiryReminders) {
        const group = groups.find((entry) => entry.id === reminder.groupId);
        if (!group) {
          continue;
        }
        try {
          await bot.api.sendMessage(Number(group.telegramChatId), reminder.message, { parse_mode: 'Markdown' });
        } catch (sendError) {
          logger.warn({ error: sendError instanceof Error ? sendError.message : String(sendError), groupId: group.id }, 'Failed to send expiry reminder');
        }
      }

      const reviewReminders = await workoutPhotoReviewService.sendHourlyReminders(now);
      for (const reminder of reviewReminders) {
        const group = groups.find((entry) => entry.id === reminder.groupId);
        if (!group) {
          continue;
        }
        try {
          await bot.api.sendMessage(Number(group.telegramChatId), reminder.message, { parse_mode: 'Markdown' });
        } catch (sendError) {
          logger.warn({ error: sendError instanceof Error ? sendError.message : String(sendError), groupId: group.id }, 'Failed to send review reminder');
        }
      }

      const resolvedReviews = await workoutPhotoReviewService.resolveExpiredReviews(now);
      for (const result of resolvedReviews) {
        const group = groups.find((entry) => entry.id === result.groupId);
        if (!group) {
          continue;
        }
        try {
          await bot.api.sendMessage(Number(group.telegramChatId), result.message, { parse_mode: 'Markdown' });
        } catch (sendError) {
          logger.warn({ error: sendError instanceof Error ? sendError.message : String(sendError), groupId: group.id }, 'Failed to send resolved review message');
        }
      }
    } catch (error) {
      logger.error({ error }, 'Scheduler tick failed');
    } finally {
      isRunning = false;
    }
  });

  logger.info('Scheduler started');

  return task;
}
