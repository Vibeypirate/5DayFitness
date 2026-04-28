import { ParticipantStatus } from '@prisma/client';
import type { Bot } from 'grammy';

import { prisma } from '../db.js';
import {
  DEFAULT_CHECK_IN_TRIGGERS,
  DEFAULT_CHECK_OUT_TRIGGERS,
  DEFAULT_MIN_SESSION_MINUTES,
  DEFAULT_REMINDER_TIME,
  DEFAULT_TIMEZONE,
  DEFAULT_WEEKLY_PENALTY,
  DEFAULT_WEEKLY_TARGET,
} from '../domain/constants.js';
import { DateTime, IANAZone } from 'luxon';
import { getGroupByChatId, listActiveParticipants } from './persistence.js';

export class GroupService {
  async detectAndStoreOwner(groupId: string, telegramChatId: string, bot: Bot): Promise<void> {
    const admins = await bot.api.getChatAdministrators(Number(telegramChatId));
    const creator = admins.find((admin) => admin.status === 'creator');
    if (!creator || creator.user.is_bot) {
      throw new Error('Group creator could not be detected. Setup cannot continue.');
    }

    const owner = await prisma.user.upsert({
      where: { telegramUserId: String(creator.user.id) },
      update: {
        username: creator.user.username ?? null,
        firstName: creator.user.first_name,
        lastName: creator.user.last_name ?? null,
        displayName: creator.user.username
          ? `@${creator.user.username}`
          : [creator.user.first_name, creator.user.last_name].filter(Boolean).join(' '),
      },
      create: {
        telegramUserId: String(creator.user.id),
        username: creator.user.username ?? null,
        firstName: creator.user.first_name,
        lastName: creator.user.last_name ?? null,
        displayName: creator.user.username
          ? `@${creator.user.username}`
          : [creator.user.first_name, creator.user.last_name].filter(Boolean).join(' '),
      },
    });

    await prisma.groupSettings.update({
      where: { groupId },
      data: { ownerUserId: owner.id },
    });
  }

  async getWelcomeMessage(telegramChatId: string): Promise<string> {
    const group = await getGroupByChatId(telegramChatId);
    if (!group) {
      throw new Error('Group has not been created yet.');
    }

    return [
      `Welcome to ${group.telegramTitle}.`,
      'This group is a weekly workout accountability challenge.',
      `Your target is ${group.settings?.weeklyTarget ?? DEFAULT_WEEKLY_TARGET} workout days each week.`,
      `The group runs on ${group.settings?.timezone ?? DEFAULT_TIMEZONE}.`,
      '',
      'All non-bot members in this group are part of the challenge.',
      'An admin starts the week with /startchallenge.',
      'First workout photo starts the session.',
      'Second workout photo ends it.',
      `Minimum session: ${group.settings?.minSessionMinutes ?? DEFAULT_MIN_SESSION_MINUTES} minutes.`,
      'Use /help for commands.',
    ].join('\n');
  }

  async getHelpMessage(groupId: string): Promise<string> {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { settings: true },
    });

    if (!group?.settings) {
      throw new Error('Run /setup first.');
    }

    return [
      '*Commands*',
      '/help',
      '/setup',
      '/status',
      '/mystats',
      '/leaderboard',
      '/weeklysummary',
      '/groupstats',
      '/rules',
      '/challengephoto @username',
      '/voidsession @username',
      '/cancelsession',
      '/complete @username',
      '/startchallenge',
      '/resetchallenge',
    ].join('\n');
  }

  async setupGroup(telegramChatId: string): Promise<string> {
    const group = await getGroupByChatId(telegramChatId);
    if (!group) {
      throw new Error('Group has not been created yet.');
    }

    return [
      `Group ready: ${group.telegramTitle}`,
      `Timezone: ${group.settings?.timezone ?? DEFAULT_TIMEZONE}`,
      `Target: ${group.settings?.weeklyTarget ?? DEFAULT_WEEKLY_TARGET}/week`,
      `Penalty: ${group.settings?.weeklyPenaltyAmount ?? DEFAULT_WEEKLY_PENALTY} baht`,
      `Min session: ${group.settings?.minSessionMinutes ?? DEFAULT_MIN_SESSION_MINUTES} minutes`,
      `Reminder: ${group.settings?.reminderTime ?? DEFAULT_REMINDER_TIME}`,
      `Automation: ${(group.settings?.automationEnabled ?? false) ? 'ON' : 'OFF'}`,
      '',
      'Next steps:',
      'All non-bot members in this group are automatically in the challenge.',
      '/startchallenge when you are ready to begin tracking',
      'First workout photo = check in',
      'Second workout photo after the minimum time = check out',
    ].join('\n');
  }

  async updateSettings(groupId: string, input: {
    weeklyTarget?: number;
    weeklyPenaltyAmount?: number;
    timezone?: string;
    minSessionMinutes?: number;
    reminderTime?: string;
    lateReminderTime?: string | null;
  }): Promise<void> {
    if (input.weeklyTarget !== undefined && input.weeklyTarget < 1) {
      throw new Error('Weekly target must be at least 1.');
    }

    if (input.weeklyPenaltyAmount !== undefined && input.weeklyPenaltyAmount < 0) {
      throw new Error('Penalty must be 0 or more.');
    }

    if (input.minSessionMinutes !== undefined && input.minSessionMinutes < 1) {
      throw new Error('Minimum duration must be at least 1 minute.');
    }

    if (input.timezone && !IANAZone.isValidZone(input.timezone)) {
      throw new Error('Invalid timezone. Use a valid IANA timezone like Asia/Bangkok.');
    }

    if (input.reminderTime && !/^\d{2}:\d{2}$/.test(input.reminderTime)) {
      throw new Error('Reminder time must be in HH:mm format.');
    }

    if (input.lateReminderTime && !/^\d{2}:\d{2}$/.test(input.lateReminderTime)) {
      throw new Error('Late reminder time must be in HH:mm format.');
    }

    await prisma.groupSettings.update({
      where: { groupId },
      data: input,
    });
  }

  async getRules(groupId: string): Promise<string> {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { settings: true },
    });

    if (!group?.settings) {
      throw new Error('Group settings not found.');
    }

    return [
      '*Rules*',
      `Timezone: ${group.settings.timezone}`,
      `Week: Monday 00:00 to Sunday 23:59`,
      `New day message: 00:01`,
      `Weekly summary: Sunday 23:59`,
      `Target: ${group.settings.weeklyTarget} workout days`,
      `Max credit: 1 per calendar day`,
      `Check-out window: 6 hours from check-in`,
      `Min session: ${group.settings.minSessionMinutes} minutes`,
      `Automation: ${group.settings.automationEnabled ? 'ON' : 'OFF'}`,
      `Penalty per failed member: ${group.settings.weeklyPenaltyAmount} baht`,
      'All non-bot group members are in the challenge automatically',
      'Photo challenge command: /challengephoto @username',
    ].join('\n');
  }

  async getGroupStats(groupId: string): Promise<string> {
    const participants = await prisma.groupParticipant.findMany({
      where: { groupId },
      include: { user: true },
    });
    const activeParticipants = participants.filter((participant) => participant.status === ParticipantStatus.ACTIVE);
    const totalCompletedDays = participants.reduce((sum, row) => sum + row.lifetimeCompletedDays, 0);
    const totalSuccessfulWeeks = participants.reduce((sum, row) => sum + row.totalSuccessfulWeeks, 0);
    const totalPenalties = participants.reduce((sum, row) => sum + row.totalPenaltiesOwed, 0);

    return [
      '*Group stats*',
      `Participants: ${participants.length}`,
      `Active now: ${activeParticipants.length}`,
      `Lifetime workout days: ${totalCompletedDays}`,
      `Successful weeks logged: ${totalSuccessfulWeeks}`,
      `Penalties owed: ${totalPenalties} baht`,
    ].join('\n');
  }

  async getParticipantMentions(groupId: string): Promise<string[]> {
    const participants = await listActiveParticipants(groupId);
    return participants.map((row) => row.user.username ? `@${row.user.username}` : row.user.displayName);
  }

  buildClockLabel(now: Date, timezone: string): string {
    return DateTime.fromJSDate(now, { zone: 'utc' }).setZone(timezone).toFormat('h:mm a');
  }

  getDefaultTriggers(): { checkInTriggers: string[]; checkOutTriggers: string[] } {
    return {
      checkInTriggers: DEFAULT_CHECK_IN_TRIGGERS,
      checkOutTriggers: DEFAULT_CHECK_OUT_TRIGGERS,
    };
  }
}
