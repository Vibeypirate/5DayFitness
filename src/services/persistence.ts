import type { Group, GroupParticipant, GroupSettings, User } from '@prisma/client';
import { ParticipantStatus, type Prisma } from '@prisma/client';

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
import { startOfWeekLocal } from '../domain/time.js';
import type { TelegramActor, TelegramGroupRef } from '../types.js';

export type GroupWithSettings = Group & { settings: GroupSettings | null };
export type ParticipantWithUser = GroupParticipant & { user: User };

export async function upsertUser(actor: TelegramActor): Promise<User> {
  return prisma.user.upsert({
    where: { telegramUserId: actor.telegramUserId },
    update: {
      username: actor.username ?? null,
      firstName: actor.firstName,
      lastName: actor.lastName ?? null,
      displayName: buildDisplayName(actor),
    },
    create: {
      telegramUserId: actor.telegramUserId,
      username: actor.username ?? null,
      firstName: actor.firstName,
      lastName: actor.lastName ?? null,
      displayName: buildDisplayName(actor),
    },
  });
}

export async function ensureGroup(groupRef: TelegramGroupRef): Promise<GroupWithSettings> {
  return prisma.group.upsert({
    where: { telegramChatId: groupRef.telegramChatId },
    update: {
      telegramTitle: groupRef.title,
      telegramUsername: groupRef.username ?? null,
      isActive: true,
    },
    create: {
      telegramChatId: groupRef.telegramChatId,
      telegramTitle: groupRef.title,
      telegramUsername: groupRef.username ?? null,
      settings: {
        create: {
          timezone: DEFAULT_TIMEZONE,
          weeklyTarget: DEFAULT_WEEKLY_TARGET,
          weeklyPenaltyAmount: DEFAULT_WEEKLY_PENALTY,
          minSessionMinutes: DEFAULT_MIN_SESSION_MINUTES,
          reminderTime: DEFAULT_REMINDER_TIME,
          checkInTriggers: DEFAULT_CHECK_IN_TRIGGERS,
          checkOutTriggers: DEFAULT_CHECK_OUT_TRIGGERS,
        },
      },
    },
    include: { settings: true },
  });
}

export async function getGroupByChatId(telegramChatId: string): Promise<GroupWithSettings | null> {
  return prisma.group.findUnique({
    where: { telegramChatId },
    include: { settings: true },
  });
}

export async function getParticipant(groupId: string, userId: string): Promise<ParticipantWithUser | null> {
  return prisma.groupParticipant.findUnique({
    where: {
      groupId_userId: {
        groupId,
        userId,
      },
    },
    include: {
      user: true,
    },
  });
}

export async function ensureActiveParticipant(groupId: string, userId: string, timezone?: string): Promise<ParticipantWithUser> {
  await prisma.groupParticipant.upsert({
    where: {
      groupId_userId: {
        groupId,
        userId,
      },
    },
    update: {
      status: ParticipantStatus.ACTIVE,
      leftAt: null,
      pausedAt: null,
      resumedAt: new Date(),
    },
    create: {
      groupId,
      userId,
      status: ParticipantStatus.ACTIVE,
      joinedWeekStartDateLocal: startOfWeekLocal(new Date(), timezone ?? DEFAULT_TIMEZONE),
    },
  });

  const participant = await getParticipant(groupId, userId);
  if (!participant) {
    throw new Error('Participant record could not be created.');
  }

  return participant;
}

export async function markParticipantPresent(
  groupId: string,
  userId: string,
  joinedAt: Date,
  timezone: string,
): Promise<GroupParticipant> {
  return prisma.groupParticipant.upsert({
    where: {
      groupId_userId: {
        groupId,
        userId,
      },
    },
    update: {
      status: ParticipantStatus.ACTIVE,
      leftAt: null,
      pausedAt: null,
      resumedAt: joinedAt,
      joinedAt,
      joinedWeekStartDateLocal: startOfWeekLocal(joinedAt, timezone),
    },
    create: {
      groupId,
      userId,
      status: ParticipantStatus.ACTIVE,
      joinedAt,
      joinedWeekStartDateLocal: startOfWeekLocal(joinedAt, timezone),
    },
  });
}

export async function markParticipantLeftGroup(
  groupId: string,
  userId: string,
  leftAt: Date,
): Promise<GroupParticipant> {
  return prisma.groupParticipant.update({
    where: {
      groupId_userId: {
        groupId,
        userId,
      },
    },
    data: {
      status: ParticipantStatus.LEFT_GROUP,
      leftAt,
      pausedAt: null,
      resumedAt: null,
    },
  });
}

export async function requireActiveParticipant(groupId: string, userId: string): Promise<ParticipantWithUser | null> {
  const participant = await getParticipant(groupId, userId);
  if (!participant || participant.status !== ParticipantStatus.ACTIVE) {
    return null;
  }
  return participant;
}

export async function listActiveParticipants(groupId: string): Promise<ParticipantWithUser[]> {
  return prisma.groupParticipant.findMany({
    where: {
      groupId,
      status: ParticipantStatus.ACTIVE,
    },
    include: {
      user: true,
    },
    orderBy: {
      user: {
        displayName: 'asc',
      },
    },
  });
}

export function buildDisplayName(actor: TelegramActor): string {
  if (actor.username) {
    return `@${actor.username}`;
  }

  return [actor.firstName, actor.lastName].filter(Boolean).join(' ');
}

export async function logAdminAction(input: {
  groupId: string;
  actorUserId: string;
  actionType: Prisma.AdminActionLogUncheckedCreateInput['actionType'];
  payloadJson: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.adminActionLog.create({
    data: input,
  });
}
