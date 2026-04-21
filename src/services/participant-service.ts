import { ParticipantStatus, SessionStatus } from '@prisma/client';

import { prisma } from '../db.js';
import { formatNetBalanceLine, formatWeekProgressLine } from '../domain/leaderboard.js';
import { summarizeLedgerRows } from '../domain/penalties.js';
import { startOfWeekLocal } from '../domain/time.js';
import { getEffectiveWeeklyTarget } from '../domain/weekly-target.js';
import { getParticipant, listActiveParticipants } from './persistence.js';

export class ParticipantService {
  async join(groupId: string, userId: string): Promise<string> {
    const existing = await getParticipant(groupId, userId);

    if (existing?.status === ParticipantStatus.ACTIVE) {
      return 'You are already in the challenge.';
    }

    if (existing) {
      await prisma.groupParticipant.update({
        where: { id: existing.id },
        data: {
          status: ParticipantStatus.ACTIVE,
          leftAt: null,
          pausedAt: null,
          resumedAt: new Date(),
        },
      });
      return 'You are back in. Time to stack the week.';
    }

    await prisma.groupParticipant.create({
      data: {
        groupId,
        userId,
        status: ParticipantStatus.ACTIVE,
      },
    });

    return 'You are in. First session wins the day.';
  }

  async leave(groupId: string, userId: string): Promise<string> {
    const participant = await getParticipant(groupId, userId);
    if (!participant || participant.status === ParticipantStatus.REMOVED) {
      return 'You are not currently in the challenge.';
    }

    await prisma.groupParticipant.update({
      where: { id: participant.id },
      data: {
        status: ParticipantStatus.REMOVED,
        leftAt: new Date(),
      },
    });

    return 'You are out of the challenge. Rejoin anytime with /joinchallenge.';
  }

  async pause(groupId: string, userId: string): Promise<string> {
    const participant = await getParticipant(groupId, userId);
    if (!participant) {
      return 'Join the challenge first with /joinchallenge.';
    }

    if (participant.status === ParticipantStatus.PAUSED) {
      return 'Your challenge status is already paused.';
    }

    await prisma.groupParticipant.update({
      where: { id: participant.id },
      data: {
        status: ParticipantStatus.PAUSED,
        pausedAt: new Date(),
      },
    });

    return 'Challenge paused. No weekly pressure until you resume.';
  }

  async resume(groupId: string, userId: string): Promise<string> {
    const participant = await getParticipant(groupId, userId);
    if (!participant) {
      return 'Join the challenge first with /joinchallenge.';
    }

    await prisma.groupParticipant.update({
      where: { id: participant.id },
      data: {
        status: ParticipantStatus.ACTIVE,
        resumedAt: new Date(),
        pausedAt: null,
      },
    });

    return 'Challenge resumed. Back on the board.';
  }

  async getStatus(groupId: string, userId: string, timezone: string): Promise<string> {
    const participant = await prisma.groupParticipant.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
      include: { user: true },
    });

    if (!participant) {
      return 'You are not in this challenge yet. Use /joinchallenge.';
    }

    const [group, weekCount, openSession, ledgerRows] = await Promise.all([
      prisma.group.findUnique({
        where: { id: groupId },
        include: { settings: true },
      }),
      prisma.workoutDayCredit.count({
        where: {
          groupId,
          userId,
          weekStartDateLocal: startOfWeekLocal(new Date(), timezone),
        },
      }),
      prisma.workoutSession.findFirst({
        where: {
          groupId,
          userId,
          status: SessionStatus.OPEN,
        },
      }),
      prisma.penaltyLedger.findMany({
        where: { groupId, userId },
        select: { type: true, amount: true },
      }),
    ]);

    const weekStart = startOfWeekLocal(new Date(), timezone);
    const effectiveTarget = getEffectiveWeeklyTarget({
      baseWeeklyTarget: group?.settings?.weeklyTarget ?? 5,
      participantJoinedDateLocal: participant.joinedAt.toISOString().slice(0, 10),
      participantJoinedWeekStartDateLocal: participant.joinedWeekStartDateLocal,
      weekStartDateLocal: weekStart,
    });
    const balance = summarizeLedgerRows(ledgerRows);

    return [
      `*${participant.user.displayName}*`,
      `Status: ${participant.status}`,
      formatWeekProgressLine(weekCount, effectiveTarget),
      `Workout-day streak: ${participant.currentWorkoutDayStreak}`,
      `Successful-week streak: ${participant.currentSuccessfulWeekStreak}`,
      `Lifetime days: ${participant.lifetimeCompletedDays}`,
      `Successful weeks: ${participant.totalSuccessfulWeeks}`,
      `Failed weeks: ${participant.totalFailedWeeks}`,
      `Penalties owed: ${participant.totalPenaltiesOwed} baht`,
      `Penalties earned: ${participant.totalPenaltiesEarned} baht`,
      formatNetBalanceLine(balance.netBalance),
      `Open session: ${openSession ? 'Yes' : 'No'}`,
    ].join('\n');
  }

  async getMyStats(groupId: string, userId: string): Promise<string> {
    const participant = await prisma.groupParticipant.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
      include: { user: true },
    });

    if (!participant) {
      return 'No participant record found.';
    }

    const ledgerRows = await prisma.penaltyLedger.findMany({
      where: { groupId, userId },
      select: { type: true, amount: true },
    });
    const balance = summarizeLedgerRows(ledgerRows);

    return [
      `*${participant.user.displayName}*`,
      `Current workout-day streak: ${participant.currentWorkoutDayStreak}`,
      `Longest workout-day streak: ${participant.longestWorkoutDayStreak}`,
      `Current successful-week streak: ${participant.currentSuccessfulWeekStreak}`,
      `Longest successful-week streak: ${participant.longestSuccessfulWeekStreak}`,
      `Lifetime completed days: ${participant.lifetimeCompletedDays}`,
      `Successful weeks: ${participant.totalSuccessfulWeeks}`,
      `Failed weeks: ${participant.totalFailedWeeks}`,
      `Total penalties owed: ${participant.totalPenaltiesOwed} baht`,
      `Total penalties earned: ${participant.totalPenaltiesEarned} baht`,
      formatNetBalanceLine(balance.netBalance),
      `Last completed workout: ${participant.lastCompletedWorkoutDate ?? 'None yet'}`,
    ].join('\n');
  }

  async getActiveParticipants(groupId: string) {
    return listActiveParticipants(groupId);
  }
}
