import { ParticipantStatus, SessionStatus } from '@prisma/client';

import { prisma } from '../db.js';
import { formatRankingLine, rankLeaderboard } from '../domain/leaderboard.js';
import { localDate, startOfWeekLocal } from '../domain/time.js';
import { getEffectiveWeeklyTarget } from '../domain/weekly-target.js';

export class LeaderboardService {
  async getCurrentLeaderboard(groupId: string, weeklyTarget: number, timezone: string): Promise<string> {
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
    const [credits, sessions] = await Promise.all([
      prisma.workoutDayCredit.findMany({
        where: {
          groupId,
          weekStartDateLocal: weekStart,
        },
      }),
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
    ]);

    const minutesByUser = new Map<string, number>();
    for (const session of sessions) {
      minutesByUser.set(
        session.userId,
        (minutesByUser.get(session.userId) ?? 0) + (session.durationMinutes ?? 0),
      );
    }

    const creditsByParticipant = new Map<string, number>();
    for (const credit of credits) {
      creditsByParticipant.set(credit.participantId, (creditsByParticipant.get(credit.participantId) ?? 0) + 1);
    }

    const ranked = rankLeaderboard(
      participants.map((participant) => ({
        participantId: participant.id,
        displayName: participant.user.displayName,
        completedDays: creditsByParticipant.get(participant.id) ?? 0,
        successfulWeekStreak: participant.currentSuccessfulWeekStreak,
        lifetimeCompletedDays: participant.lifetimeCompletedDays,
      })),
    );

    if (ranked.length === 0) {
      return 'No active participants yet.';
    }

    return [
      `*Leaderboard*`,
      ...ranked.map((row, index) => {
        const participant = participants.find((entry) => entry.id === row.participantId);
        return formatRankingLine({
          rankLabel: `${index + 1}.`,
          displayName: row.displayName,
          completedDays: row.completedDays,
          weeklyTarget: participant
            ? getEffectiveWeeklyTarget({
                baseWeeklyTarget: weeklyTarget,
                participantJoinedDateLocal: localDate(participant.joinedAt, timezone),
                participantJoinedWeekStartDateLocal: participant.joinedWeekStartDateLocal,
                weekStartDateLocal: weekStart,
              })
            : weeklyTarget,
          currentWorkoutDayStreak: participant?.currentWorkoutDayStreak ?? 0,
          lifetimeCompletedDays: row.lifetimeCompletedDays,
          totalMinutes: participant ? (minutesByUser.get(participant.userId) ?? 0) : 0,
        });
      }),
    ].join('\n');
  }

  async getLatestWeeklySummary(groupId: string): Promise<string> {
    const snapshot = await prisma.weeklySnapshot.findFirst({
      where: {
        groupId,
      },
      include: {
        results: {
          include: {
            user: true,
          },
          orderBy: {
            rank: 'asc',
          },
        },
      },
      orderBy: {
        weekStartDateLocal: 'desc',
      },
    });

    if (!snapshot) {
      return 'No weekly summary has been recorded yet.';
    }

    const sessions = await prisma.workoutSession.findMany({
      where: {
        groupId,
        status: SessionStatus.COMPLETED,
        durationMinutes: {
          not: null,
        },
        creditDateLocal: {
          gte: snapshot.weekStartDateLocal,
          lte: snapshot.weekEndDateLocal,
        },
      },
      select: {
        userId: true,
        durationMinutes: true,
      },
    });

    const minutesByUser = new Map<string, number>();
    for (const session of sessions) {
      minutesByUser.set(
        session.userId,
        (minutesByUser.get(session.userId) ?? 0) + (session.durationMinutes ?? 0),
      );
    }

    const rankedByHours = [...snapshot.results]
      .map((result) => ({
        ...result,
        totalMinutes: minutesByUser.get(result.userId) ?? 0,
      }))
      .sort((left, right) => {
        if (right.totalMinutes !== left.totalMinutes) {
          return right.totalMinutes - left.totalMinutes;
        }
        if (right.completedDays !== left.completedDays) {
          return right.completedDays - left.completedDays;
        }
        return left.user.displayName.localeCompare(right.user.displayName);
      });

    return [
      `*Week ${snapshot.weekStartDateLocal} to ${snapshot.weekEndDateLocal}*`,
      '',
      '*Hours podium*',
      ...rankedByHours.slice(0, 3).map((result, index) => `${this.medalFor(index)} ${result.user.displayName} ${this.formatHours(result.totalMinutes)}`),
      '',
      '*Weekly rankings*',
      ...rankedByHours.map(
        (result, index) =>
          formatRankingLine({
            rankLabel: this.medalFor(index),
            displayName: result.user.displayName,
            completedDays: result.completedDays,
            weeklyTarget: snapshot.weeklyTarget,
            currentWorkoutDayStreak: result.currentWorkoutDayStreak,
            lifetimeCompletedDays: result.lifetimeCompletedDays,
            totalMinutes: result.totalMinutes,
          }),
      ),
      `Missed ${snapshot.weeklyTarget} days: ${rankedByHours.filter((result) => !result.metTarget).map((result) => result.user.displayName).join(', ') || 'Nobody'}`,
      snapshot.unresolvedPenaltyPool > 0
        ? `Penalty pool unresolved: ${snapshot.unresolvedPenaltyPool} baht`
        : 'Penalty pool distributed.',
    ].join('\n');
  }

  private medalFor(index: number): string {
    if (index === 0) {
      return '🥇';
    }
    if (index === 1) {
      return '🥈';
    }
    if (index === 2) {
      return '🥉';
    }
    return `${index + 1}.`;
  }

  private formatHours(totalMinutes: number): string {
    return `${(totalMinutes / 60).toFixed(1)}h`;
  }
}
