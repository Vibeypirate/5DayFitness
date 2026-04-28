import { ParticipantStatus, SessionStatus } from '@prisma/client';

import { prisma } from '../db.js';
import { DEFAULT_MAX_CHECKOUT_HOURS } from '../domain/constants.js';
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

    const ageHours = (input.sentAt.getTime() - openSession.checkInAtUtc.getTime()) / 3600000;
    if (ageHours > DEFAULT_MAX_CHECKOUT_HOURS) {
      await prisma.workoutSession.update({
        where: { id: openSession.id },
        data: {
          status: SessionStatus.ABANDONED,
          abandonedAtUtc: new Date(),
          abandonedReason: 'EXPIRED',
        },
      });
      const newSessionResponse = await this.startSession(participant, settings, input);
      return {
        primary: `Your previous workout from ${this.formatLocalTime(openSession.checkInAtUtc, settings.timezone)} was abandoned because you didn't check out within ${DEFAULT_MAX_CHECKOUT_HOURS} hours.\n\n${newSessionResponse.primary}`,
      };
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
    if (ageHours > DEFAULT_MAX_CHECKOUT_HOURS) {
      await prisma.workoutSession.update({
        where: { id: openSession.id },
        data: {
          status: SessionStatus.ABANDONED,
          abandonedAtUtc: new Date(),
          abandonedReason: 'EXPIRED',
        },
      });
      return {
        primary: `Check-out rejected. You must check out within ${DEFAULT_MAX_CHECKOUT_HOURS} hours of check-in. Your previous session has been abandoned. Please check in again to start a new workout.`,
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
      this.getProgressLeaderboard(input.groupId, settings.timezone),
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

  async sendExpiryReminders(now: Date): Promise<Array<{ groupId: string; message: string }>> {
    const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);

    const sessions = await prisma.workoutSession.findMany({
      where: {
        status: SessionStatus.OPEN,
        checkInAtUtc: {
          lte: fiveHoursAgo,
        },
        expiryReminderSentAt: null,
      },
      include: {
        user: true,
      },
    });

    const reminders: Array<{ groupId: string; message: string }> = [];

    for (const session of sessions) {
      reminders.push({
        groupId: session.groupId,
        message: `@${session.user.username ?? session.user.displayName}, you checked in 5 hours ago. You have 1 hour left to check out or this session will be abandoned.`,
      });

      await prisma.workoutSession.update({
        where: { id: session.id },
        data: { expiryReminderSentAt: now },
      });
    }

    return reminders;
  }

  async cancelOwnSession(
    groupId: string,
    userId: string,
    timezone: string,
  ): Promise<{ success: boolean; message: string }> {
    const openSession = await prisma.workoutSession.findFirst({
      where: {
        groupId,
        userId,
        status: SessionStatus.OPEN,
      },
      orderBy: {
        checkInAtUtc: 'desc',
      },
    });

    if (!openSession) {
      return { success: false, message: 'You do not have an open workout session to cancel.' };
    }

    await prisma.workoutSession.update({
      where: { id: openSession.id },
      data: {
        status: SessionStatus.ABANDONED,
        abandonedAtUtc: new Date(),
        abandonedReason: 'USER_CANCELLED',
      },
    });

    return {
      success: true,
      message: `Your workout from ${this.formatLocalTime(openSession.checkInAtUtc, timezone)} has been cancelled. Send a photo to check in for a new workout.`,
    };
  }

  async completeWorkoutForUser(
    participant: ParticipantWithUser,
    settings: {
      weeklyTarget: number;
      minSessionMinutes: number;
      timezone: string;
    },
    input: {
      groupId: string;
      userId: string;
    },
  ): Promise<WorkoutResponse> {
    const now = new Date();
    const creditDateLocal = localDate(now, settings.timezone);
    const weekStartDateLocal = startOfWeekLocal(now, settings.timezone);

    const openSession = await prisma.workoutSession.findFirst({
      where: {
        groupId: input.groupId,
        userId: input.userId,
        status: SessionStatus.OPEN,
      },
    });

    if (openSession) {
      await prisma.workoutSession.update({
        where: { id: openSession.id },
        data: {
          status: SessionStatus.ABANDONED,
          abandonedAtUtc: now,
          abandonedReason: 'ADMIN_COMPLETED',
        },
      });
    }

    const alreadyCreditedToday = Boolean(
      await prisma.workoutDayCredit.findUnique({
        where: {
          groupId_userId_creditDateLocal: {
            groupId: input.groupId,
            userId: input.userId,
            creditDateLocal,
          },
        },
      }),
    );

    const shouldCredit = !alreadyCreditedToday;

    await prisma.$transaction(async (tx) => {
      if (shouldCredit) {
        await tx.workoutDayCredit.create({
          data: {
            groupId: input.groupId,
            userId: input.userId,
            participantId: participant.id,
            creditDateLocal,
            weekStartDateLocal,
            timezone: settings.timezone,
            source: 'ADMIN_OVERRIDE',
          },
        });
      }

      const streak = applyWorkoutDayStreak(
        participant.currentWorkoutDayStreak,
        participant.longestWorkoutDayStreak,
        participant.lastCompletedWorkoutDate,
        creditDateLocal,
      );

      await tx.groupParticipant.update({
        where: { id: participant.id },
        data: {
          currentWorkoutDayStreak: streak.currentStreak,
          longestWorkoutDayStreak: streak.longestStreak,
          lifetimeCompletedDays: {
            increment: shouldCredit ? 1 : 0,
          },
          lastCompletedWorkoutDate: creditDateLocal,
        },
      });
    });

    const [weekProgress, leaderboard] = await Promise.all([
      this.getWeekProgress(input.groupId, input.userId, settings.timezone),
      this.getProgressLeaderboard(input.groupId, settings.timezone),
    ]);

    return {
      primary: [
        `Workout completed for ${participant.user.displayName}.`,
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

  async getProgressLeaderboard(groupId: string, timezone: string): Promise<string> {
    const weekStart = startOfWeekLocal(new Date(), timezone);

    const participants = await prisma.groupParticipant.findMany({
      where: {
        groupId,
        status: ParticipantStatus.ACTIVE,
      },
      include: {
        user: true,
      },
    });

    const [sessions, credits] = await Promise.all([
      prisma.workoutSession.findMany({
        where: {
          groupId,
          status: SessionStatus.COMPLETED,
          durationMinutes: {
            not: null,
          },
          creditDateLocal: {
            gte: weekStart,
          },
        },
        select: {
          userId: true,
          durationMinutes: true,
        },
      }),
      prisma.workoutDayCredit.findMany({
        where: {
          groupId,
          weekStartDateLocal: weekStart,
        },
      }),
    ]);

    const totalMinutesByUser = new Map<string, number>();
    for (const session of sessions) {
      totalMinutesByUser.set(
        session.userId,
        (totalMinutesByUser.get(session.userId) ?? 0) + (session.durationMinutes ?? 0),
      );
    }

    const creditsByParticipant = new Map<string, number>();
    for (const credit of credits) {
      creditsByParticipant.set(credit.participantId, (creditsByParticipant.get(credit.participantId) ?? 0) + 1);
    }

    const ranked = rankLeaderboard(
      participants.map((row) => ({
        participantId: row.id,
        displayName: row.user.displayName,
        completedDays: creditsByParticipant.get(row.id) ?? 0,
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
          completedDays: row.completedDays,
          weeklyTarget: undefined,
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
