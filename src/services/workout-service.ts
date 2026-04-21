import { ParticipantStatus, SessionStatus } from '@prisma/client';

import { prisma } from '../db.js';
import { formatRankingLine, rankLeaderboard } from '../domain/leaderboard.js';
import { applyWorkoutDayStreak } from '../domain/streaks.js';
import { localDate, minutesBetween, startOfWeekLocal } from '../domain/time.js';
import type { ParticipantWithUser } from './persistence.js';

export type WorkoutMessageInput = {
  groupId: string;
  userId: string;
  text?: string | null;
  photoFileId?: string | null;
  messageId?: number | null;
  sentAt: Date;
};

export type WorkoutResponse = {
  primary: string;
  leaderboard?: string;
};

export class WorkoutService {
  async handleWorkoutMessage(
    participant: ParticipantWithUser | null,
    settings: {
      weeklyTarget: number;
      minSessionMinutes: number;
      timezone: string;
    },
    input: WorkoutMessageInput,
  ): Promise<WorkoutResponse> {
    if (!input.photoFileId) {
      return { primary: 'A workout photo is required.' };
    }

    if (!participant || participant.status !== ParticipantStatus.ACTIVE) {
      throw new Error('You need to be an active group member to log workouts.');
    }

    const openSession = await prisma.workoutSession.findFirst({
      where: {
        groupId: input.groupId,
        userId: input.userId,
        status: SessionStatus.OPEN,
      },
      orderBy: {
        checkInAtUtc: 'desc',
      },
    });

    if (!openSession) {
      return this.startSession(participant, settings, input);
    }

    return this.completeSession(participant, settings, input, openSession);
  }

  private async startSession(
    participant: ParticipantWithUser,
    settings: {
      weeklyTarget: number;
      minSessionMinutes: number;
      timezone: string;
    },
    input: WorkoutMessageInput,
  ): Promise<WorkoutResponse> {

    const creditDateLocal = localDate(input.sentAt, settings.timezone);

    await prisma.workoutSession.create({
      data: {
        groupId: input.groupId,
        userId: input.userId,
        participantId: participant.id,
        status: SessionStatus.OPEN,
        checkInAtUtc: input.sentAt,
        checkInPhotoFileId: input.photoFileId!,
        checkInMessageId: input.messageId ?? null,
        checkInCaption: input.text ?? null,
        creditDateLocal,
        timezone: settings.timezone,
      },
    });

    const weekProgress = await this.getWeekProgress(input.groupId, input.userId, settings.timezone);

    return {
      primary: [
        `${participant.user.displayName} checked in at ${this.formatLocalTime(input.sentAt, settings.timezone)}.`,
        'Enjoy your workout. Send your next photo when you are done.',
        `Minimum workout time: ${settings.minSessionMinutes} minutes.`,
        `Week progress: ${weekProgress}/${settings.weeklyTarget}`,
      ].join('\n'),
    };
  }

  private async completeSession(
    participant: ParticipantWithUser,
    settings: {
      weeklyTarget: number;
      minSessionMinutes: number;
      timezone: string;
    },
    input: WorkoutMessageInput,
    openSession: {
      id: string;
      checkInAtUtc: Date;
      creditDateLocal: string;
    },
  ): Promise<WorkoutResponse> {
    const durationMinutes = minutesBetween(openSession.checkInAtUtc, input.sentAt);

    if (durationMinutes < settings.minSessionMinutes) {
      const minutesLeft = settings.minSessionMinutes - durationMinutes;
      return {
        primary: [
          `Keep going, ${participant.user.displayName}.`,
          `Your workout has been running for ${durationMinutes} minutes.`,
          `You need at least ${minutesLeft} more minute${minutesLeft === 1 ? '' : 's'} before checkout.`,
        ].join('\n'),
      };
    }

    const ageHours = (input.sentAt.getTime() - openSession.checkInAtUtc.getTime()) / 3600000;
    if (ageHours > 24) {
      return {
        primary: 'Checkout rejected. Check-out must happen within 24 hours of check-in.',
      };
    }

    const alreadyCreditedToday = openSession
      ? Boolean(
          await prisma.workoutDayCredit.findUnique({
            where: {
              groupId_userId_creditDateLocal: {
                groupId: input.groupId,
                userId: input.userId,
                creditDateLocal: openSession.creditDateLocal,
              },
            },
          }),
        )
      : false;
    const shouldCredit = !alreadyCreditedToday;
    const weekStartDateLocal = startOfWeekLocal(openSession.checkInAtUtc, settings.timezone);

    await prisma.$transaction(async (tx) => {
      await tx.workoutSession.update({
        where: { id: openSession.id },
        data: {
          status: SessionStatus.COMPLETED,
          checkOutAtUtc: input.sentAt,
          checkOutPhotoFileId: input.photoFileId!,
          checkOutMessageId: input.messageId ?? null,
          checkOutCaption: input.text ?? null,
          durationMinutes,
        },
      });

      if (!shouldCredit) {
        return;
      }

      await tx.workoutDayCredit.create({
        data: {
          groupId: input.groupId,
          userId: input.userId,
          participantId: participant.id,
          workoutSessionId: openSession.id,
          creditDateLocal: openSession.creditDateLocal,
          weekStartDateLocal,
          timezone: settings.timezone,
          source: 'SESSION',
        },
      });

      const streak = applyWorkoutDayStreak(
        participant.currentWorkoutDayStreak,
        participant.longestWorkoutDayStreak,
        participant.lastCompletedWorkoutDate,
        openSession.creditDateLocal,
      );

      await tx.groupParticipant.update({
        where: { id: participant.id },
        data: {
          currentWorkoutDayStreak: streak.currentStreak,
          longestWorkoutDayStreak: streak.longestStreak,
          lifetimeCompletedDays: {
            increment: 1,
          },
          lastCompletedWorkoutDate: openSession.creditDateLocal,
        },
      });
    });

    const [weekProgress, leaderboard] = await Promise.all([
      this.getWeekProgress(input.groupId, input.userId, settings.timezone),
      this.getProgressLeaderboard(input.groupId),
    ]);

    return {
      primary: [
        `Good workout, ${participant.user.displayName}!`,
        `You worked out for ${this.formatDuration(durationMinutes)}.`,
        `Today counted: ${shouldCredit ? 'Yes' : 'Already counted earlier'}`,
        `Week progress: ${weekProgress}/${settings.weeklyTarget}`,
        'See you again tomorrow. Great job staying fit.',
      ].join('\n'),
      leaderboard,
    };
  }

  async getWeekProgress(groupId: string, userId: string, timezone: string): Promise<number> {
    const weekStart = startOfWeekLocal(new Date(), timezone);
    return prisma.workoutDayCredit.count({
      where: {
        groupId,
        userId,
        weekStartDateLocal: weekStart,
      },
    });
  }

  async getProgressLeaderboard(groupId: string): Promise<string> {
    const participants = await prisma.groupParticipant.findMany({
      where: {
        groupId,
        status: ParticipantStatus.ACTIVE,
      },
      include: {
        user: true,
      },
    });
    const sessions = await prisma.workoutSession.findMany({
      where: {
        groupId,
        status: SessionStatus.COMPLETED,
        durationMinutes: {
          not: null,
        },
      },
      select: {
        userId: true,
        durationMinutes: true,
      },
    });

    const totalMinutesByUser = new Map<string, number>();
    for (const session of sessions) {
      totalMinutesByUser.set(
        session.userId,
        (totalMinutesByUser.get(session.userId) ?? 0) + (session.durationMinutes ?? 0),
      );
    }

    const ranked = rankLeaderboard(
      participants.map((row) => ({
        participantId: row.id,
        displayName: row.user.displayName,
        completedDays: row.lifetimeCompletedDays,
        successfulWeekStreak: row.currentSuccessfulWeekStreak,
        lifetimeCompletedDays: row.lifetimeCompletedDays,
      })),
    );

    if (ranked.length === 0) {
      return 'Leaderboard: no active participants yet.';
    }

    return [
      '*Rankings*',
      ...ranked.map((row, index) => {
        const participant = participants.find((entry) => entry.id === row.participantId);
        const totalMinutes = participant ? (totalMinutesByUser.get(participant.userId) ?? 0) : 0;
        const streak = participant?.currentWorkoutDayStreak ?? 0;

        return formatRankingLine({
          rankLabel: `${index + 1}.`,
          displayName: row.displayName,
          currentWorkoutDayStreak: streak,
          lifetimeCompletedDays: row.lifetimeCompletedDays,
          totalMinutes,
        });
      }),
    ].join('\n');
  }

  private formatLocalTime(value: Date, timezone: string): string {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(value);
  }

  private formatDuration(durationMinutes: number): string {
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;

    if (hours === 0) {
      return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }

    if (minutes === 0) {
      return `${hours} hour${hours === 1 ? '' : 's'}`;
    }

    return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  private formatHours(totalMinutes: number): string {
    return `${(totalMinutes / 60).toFixed(1)} total hours`;
  }

  async recomputeParticipantStats(participantId: string): Promise<void> {
    const participant = await prisma.groupParticipant.findUnique({
      where: { id: participantId },
      include: {
        group: {
          include: {
            settings: true,
          },
        },
      },
    });

    if (!participant?.group.settings) {
      return;
    }

    const credits = await prisma.workoutDayCredit.findMany({
      where: { participantId },
      orderBy: { creditDateLocal: 'asc' },
      select: { creditDateLocal: true },
    });

    const dates = credits.map((credit) => credit.creditDateLocal);
    const lifetimeCompletedDays = dates.length;
    const lastCompletedWorkoutDate = dates.at(-1) ?? null;

    let longestWorkoutDayStreak = 0;
    let runningStreak = 0;
    let previousDate: string | null = null;

    for (const creditDate of dates) {
      if (!previousDate) {
        runningStreak = 1;
      } else {
        const previous = new Date(`${previousDate}T00:00:00.000Z`);
        const current = new Date(`${creditDate}T00:00:00.000Z`);
        const diffDays = Math.round((current.getTime() - previous.getTime()) / 86400000);
        runningStreak = diffDays === 1 ? runningStreak + 1 : 1;
      }

      longestWorkoutDayStreak = Math.max(longestWorkoutDayStreak, runningStreak);
      previousDate = creditDate;
    }

    await prisma.groupParticipant.update({
      where: { id: participantId },
      data: {
        currentWorkoutDayStreak: runningStreak,
        longestWorkoutDayStreak,
        lifetimeCompletedDays,
        lastCompletedWorkoutDate,
      },
    });
  }
}
