import { Bot, InputFile, webhookCallback, type CommandContext, type Context } from 'grammy';
import { SessionStatus } from '@prisma/client';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { config } from '../config.js';
import { logger } from '../logger.js';
import { AdminService } from '../services/admin-service.js';
import { ExportService } from '../services/export-service.js';
import { GroupService } from '../services/group-service.js';
import { LeaderboardService } from '../services/leaderboard-service.js';
import { ParticipantService } from '../services/participant-service.js';
import { WorkoutPhotoReviewService } from '../services/workout-photo-review-service.js';
import { ensureActiveParticipant, getParticipant, markParticipantPresent, upsertUser } from '../services/persistence.js';
import { WorkoutService } from '../services/workout-service.js';
import { requireAdmin, ensureGroupAndActor, requireConfiguredGroup } from './utils.js';

const groupService = new GroupService();
const participantService = new ParticipantService();
const leaderboardService = new LeaderboardService();
const workoutService = new WorkoutService();
const workoutPhotoReviewService = new WorkoutPhotoReviewService();
const adminService = new AdminService();
const exportService = new ExportService();

export function createBot() {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  bot.api.config.use((prev, method, payload, signal) => prev(method, payload, signal));

  bot.catch((error) => {
    logger.error({ error }, 'Telegram update failed');
  });

  bot.command('setup', async (ctx) => {
    try {
      const { group, user } = await ensureGroupAndActor(ctx);
      await groupService.detectAndStoreOwner(group.id, group.telegramChatId, bot);
      const message = await groupService.setupGroup(group.telegramChatId);
      await ctx.reply(message);
      logger.info({ groupId: group.id, userId: user.id }, 'Group setup completed');
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Setup failed.');
    }
  });

  bot.command('help', async (ctx) => {
    try {
      const group = await requireConfiguredGroup(ctx);
      await ctx.reply(await groupService.getHelpMessage(group.id), { parse_mode: 'Markdown' });
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Help unavailable.');
    }
  });

  bot.on('message:new_chat_members', async (ctx) => {
    try {
      const { group } = await ensureGroupAndActor(ctx);
      for (const member of ctx.message.new_chat_members) {
        if (member.is_bot) {
          continue;
        }

        const user = await upsertUser({
          telegramUserId: String(member.id),
          username: member.username ?? null,
          firstName: member.first_name,
          lastName: member.last_name ?? null,
        });

        await markParticipantPresent(
          group.id,
          user.id,
          new Date(ctx.message.date * 1000),
          group.settings!.timezone,
        );
      }

      await ctx.reply(await groupService.getWelcomeMessage(group.telegramChatId));
    } catch {
      return;
    }
  });

  bot.on('message:left_chat_member', async (ctx) => {
    try {
      const group = await requireConfiguredGroup(ctx);
      const member = ctx.message.left_chat_member;
      if (member.is_bot) {
        return;
      }

      const user = await upsertUser({
        telegramUserId: String(member.id),
        username: member.username ?? null,
        firstName: member.first_name,
        lastName: member.last_name ?? null,
      });

      await adminService.recordLeaveFromGroup(group.id, user.id, new Date(ctx.message.date * 1000));
    } catch {
      return;
    }
  });

  bot.command('rules', async (ctx) => {
    try {
      const group = await requireConfiguredGroup(ctx);
      await ctx.reply(await groupService.getRules(group.id), { parse_mode: 'Markdown' });
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Rules unavailable.');
    }
  });

  bot.command('status', async (ctx) => {
    try {
      const { group, user } = await ensureGroupAndActor(ctx);
      await ctx.reply(await participantService.getStatus(group.id, user.id, group.settings!.timezone), {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Stats unavailable.');
    }
  });

  bot.command('mystats', async (ctx) => {
    try {
      const { group, user } = await ensureGroupAndActor(ctx);
      await ctx.reply(await participantService.getMyStats(group.id, user.id), {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Stats unavailable.');
    }
  });

  bot.command('groupstats', async (ctx) => {
    try {
      const group = await requireConfiguredGroup(ctx);
      await ctx.reply(await groupService.getGroupStats(group.id), { parse_mode: 'Markdown' });
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Group stats unavailable.');
    }
  });

  bot.command('leaderboard', async (ctx) => {
    try {
      const group = await requireConfiguredGroup(ctx);
      await ctx.reply(
        await leaderboardService.getCurrentLeaderboard(
          group.id,
          group.settings!.weeklyTarget,
          group.settings!.timezone,
        ),
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Leaderboard unavailable.');
    }
  });

  bot.command('weeklysummary', async (ctx) => {
    try {
      const group = await requireConfiguredGroup(ctx);
      await ctx.reply(await leaderboardService.getLatestWeeklySummary(group.id), {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Weekly summary unavailable.');
    }
  });

  bot.command('settarget', async (ctx) => handleAdminSetting(ctx, { weeklyTarget: parseInt(ctx.match, 10) }));
  bot.command('setpenalty', async (ctx) =>
    handleAdminSetting(ctx, { weeklyPenaltyAmount: parseInt(ctx.match, 10) }),
  );
  bot.command('settimezone', async (ctx) => handleAdminSetting(ctx, { timezone: ctx.match.trim() }));
  bot.command('setminduration', async (ctx) =>
    handleAdminSetting(ctx, { minSessionMinutes: parseInt(ctx.match, 10) }),
  );
  bot.command('setremindertime', async (ctx) =>
    handleAdminSetting(ctx, { reminderTime: ctx.match.trim() }),
  );

  bot.command('exportcsv', async (ctx) => {
    try {
      await requireAdmin(ctx);
      const { group } = await ensureGroupAndActor(ctx);
      const csv = await exportService.exportGroupCsv(group.id);
      const filePath = join(tmpdir(), `fitness-${group.id}.csv`);
      await writeFile(filePath, csv, 'utf8');
      await ctx.replyWithDocument(new InputFile(filePath));
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'CSV export failed.');
    }
  });

  bot.command('addparticipant', async (ctx) => {
    try {
      await requireAdmin(ctx);
      const { group, user } = await ensureGroupAndActor(ctx);
      const target = await resolveUserFromArgument(ctx.match);
      await ctx.reply(await adminService.addParticipant(group.id, user.id, target.id));
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Add participant failed.');
    }
  });

  bot.command('removeparticipant', async (ctx) => {
    try {
      await requireAdmin(ctx);
      const { group, user } = await ensureGroupAndActor(ctx);
      const target = await resolveUserFromArgument(ctx.match);
      await ctx.reply(await adminService.removeParticipant(group.id, user.id, target.id));
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Remove participant failed.');
    }
  });

  bot.command('overridecomplete', async (ctx) => {
    try {
      await requireAdmin(ctx);
      const { group, user } = await ensureGroupAndActor(ctx);
      const parts = ctx.match.trim().split(/\s+/).filter(Boolean);
      if (parts.length < 2) {
        throw new Error('Usage: /overridecomplete @username YYYY-MM-DD');
      }
      const target = await resolveUserByHandle(parts[0]!.replace('@', ''));
      await ctx.reply(
        await adminService.overrideComplete(
          group.id,
          user.id,
          target.id,
          parts[1]!,
          group.settings!.timezone,
        ),
      );
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Override failed.');
    }
  });

  bot.command('overridepenalty', async (ctx) => {
    try {
      await requireAdmin(ctx);
      const { group, user } = await ensureGroupAndActor(ctx);
      const parts = ctx.match.trim().split(/\s+/).filter(Boolean);
      if (parts.length < 3) {
        throw new Error('Usage: /overridepenalty @username amount reason');
      }
      const target = await resolveUserByHandle(parts[0]!.replace('@', ''));
      const amount = parseInt(parts[1]!, 10);
      const description = parts.slice(2).join(' ');
      await ctx.reply(await adminService.overridePenalty(group.id, user.id, target.id, amount, description));
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Penalty override failed.');
    }
  });

  bot.command('resetweek', async (ctx) => {
    await ctx.reply('Weekly reset is automated. Use this only through ops if you need a manual replay.');
  });

  bot.command('startchallenge', async (ctx) => {
    try {
      await requireAdmin(ctx);
      const { group, user } = await ensureGroupAndActor(ctx);
      await ctx.reply(await adminService.startChallenge(group.id, user.id));
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Start failed.');
    }
  });

  bot.command('resetchallenge', async (ctx) => {
    try {
      await requireAdmin(ctx);
      const { group, user } = await ensureGroupAndActor(ctx);
      await ctx.reply(await adminService.resetChallenge(group.id, user.id));
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Reset failed.');
    }
  });

  bot.command('challengephoto', async (ctx) => {
    try {
      const { group, user } = await ensureGroupAndActor(ctx);
      const target = await resolveUserFromArgument(ctx.match);
      await ctx.reply(await workoutPhotoReviewService.beginChallengePrompt(
        group.id,
        user.id,
        target.id,
      ));
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Photo review failed.');
    }
  });

  bot.command('voidsession', async (ctx) => {
    try {
      const { group, user } = await ensureGroupAndActor(ctx);
      const target = await resolveUserFromArgument(ctx.match);
      const result = await workoutPhotoReviewService.beginVoidVote(
        group.id,
        user.id,
        target.id,
      );
      const sent = await ctx.reply(result.message, { parse_mode: 'Markdown' });
      await workoutPhotoReviewService.attachReviewMessageId(result.reviewId, sent.message_id);
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Void vote failed.');
    }
  });

  bot.on('message:photo', async (ctx) => {
    try {
      const { group, user } = await ensureGroupAndActor(ctx);
      if (!group.settings?.automationEnabled) {
        await ctx.reply('Challenge has not started yet. An admin needs to run /startchallenge first.');
        return;
      }
      const participant = (await getParticipant(group.id, user.id))
        ?? (await ensureActiveParticipant(group.id, user.id));
      const photo = ctx.message.photo.at(-1);
      const response = await workoutService.handleWorkoutMessage(
        participant,
        {
          weeklyTarget: group.settings!.weeklyTarget,
          minSessionMinutes: group.settings!.minSessionMinutes,
          timezone: group.settings!.timezone,
        },
        {
          groupId: group.id,
          userId: user.id,
          text: ctx.message.caption ?? null,
          photoFileId: photo?.file_id ?? null,
          messageId: ctx.message.message_id,
          sentAt: new Date(ctx.message.date * 1000),
        },
      );
      await ctx.reply(response.primary, { parse_mode: 'Markdown' });
      if (response.leaderboard) {
        await ctx.reply(response.leaderboard, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Workout flow failed.');
    }
  });

  bot.on('message:text', async (ctx) => {
    try {
      const isCommandMessage = ctx.message.entities?.some(
        (entity) => entity.type === 'bot_command' && entity.offset === 0,
      );
      if (isCommandMessage) {
        return;
      }

      const { group, user } = await ensureGroupAndActor(ctx);
      const completedChallenge = await workoutPhotoReviewService.tryCompleteChallengePrompt(
        group.id,
        user.id,
        ctx.message.text,
      );
      if (completedChallenge) {
        const sent = await ctx.reply(completedChallenge.message, { parse_mode: 'Markdown' });
        await workoutPhotoReviewService.attachReviewMessageId(completedChallenge.reviewId, sent.message_id);
        return;
      }

      if (!group.settings?.automationEnabled) {
        return;
      }
      const participant = await getParticipant(group.id, user.id);
      if (!participant) {
        return;
      }

      const openSession = await import('../db.js').then(({ prisma }) =>
        prisma.workoutSession.findFirst({
          where: {
            groupId: group.id,
            userId: user.id,
            status: SessionStatus.OPEN,
          },
          orderBy: {
            checkInAtUtc: 'desc',
          },
        }),
      );

      if (openSession) {
        const minutesOpen = Math.max(
          0,
          Math.floor((Date.now() - openSession.checkInAtUtc.getTime()) / 60000),
        );
        const minutesLeft = Math.max(group.settings!.minSessionMinutes - minutesOpen, 0);
        await ctx.reply(
          minutesLeft > 0
            ? `Workout in progress. Send your checkout photo in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`
            : 'Workout in progress. Send your checkout photo when you are done.',
        );
      }
    } catch {
      return;
    }
  });

  bot.reaction([ '👍', '👎' ], async (ctx) => {
    try {
      const { group, user } = await ensureGroupAndActor(ctx);
      const emoji = ctx.reactions().emojiAdded[0] ?? ctx.reactions().emoji[0];
      const messageId = ctx.update.message_reaction?.message_id;
      if (!emoji || !messageId) {
        return;
      }

      const result = await workoutPhotoReviewService.recordReactionVote({
        groupId: group.id,
        reviewMessageId: messageId,
        voterUserId: user.id,
        emoji,
      });

      if (result) {
        await ctx.reply(result);
      }
    } catch {
      return;
    }
  });

  async function handleAdminSetting(
    ctx: CommandContext<Context>,
    input: {
      weeklyTarget?: number;
      weeklyPenaltyAmount?: number;
      timezone?: string;
      minSessionMinutes?: number;
      reminderTime?: string;
    },
  ) {
    try {
      await requireAdmin(ctx);
      const { group } = await ensureGroupAndActor(ctx);
      await groupService.updateSettings(group.id, input);
      await ctx.reply('Settings updated.');
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Settings update failed.');
    }
  }

  return bot;
}

async function resolveUserFromArgument(argument: string) {
  const trimmed = argument.trim();
  if (!trimmed.startsWith('@')) {
    throw new Error('Provide a target as @username.');
  }
  return resolveUserByHandle(trimmed.replace('@', ''));
}

async function resolveUserByHandle(username: string) {
  const normalized = username.replace('@', '');
  const { prisma } = await import('../db.js');
  const user = await prisma.user.findFirst({
    where: { username: normalized },
  });
  if (!user) {
    throw new Error(`User @${normalized} not found in database.`);
  }
  return user;
}

export function createWebhookHandler(bot: ReturnType<typeof createBot>) {
  return webhookCallback(bot, 'express');
}
