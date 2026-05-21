import {
  ParticipantStatus,
  PenaltyLedgerType,
  ScheduledJobStatus,
  ScheduledJobType,
  SessionStatus,
} from '@prisma/client';

import { prisma } from '../db.js';
import { formatRankingLine, rankLeaderboard } from '../domain/leaderboard.js';
import { calculatePenaltyDistribution } from '../domain/penalties.js';
import { nextSuccessfulWeekStreak } from '../domain/streaks.js';
import { endOfWeekLocal, getWeekToSummarizeStart, startOfWeekLocal } from '../domain/time.js';
import { getEffectiveWeeklyTarget } from '../domain/weekly-target.js';

export class WeeklyRollupService {
  async runWeeklySummary(groupId: string, now: Date): Promise<string | null> {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { settings: true },
    });

    if (!group?.settings) {
      return null;
    }

    const previousWeekStart = getWeekToSummarizeStart(now, group.settings.timezone);
    const previousWeekEnd = endOfWeekLocal(
      new Date(`${previousWeekStart}T12:00:00.000Z`),
      group.settings.timezone,
    );
    const jobKey = previousWeekStart;

    const existingJob = await prisma.scheduledJobLog.findUnique({
      where: {
        groupId_jobType_jobKey: {
          groupId,
          jobType: ScheduledJobType.WEEKLY_SUMMARY,
          jobKey,
        },
      },
    });
    if (existingJob) {
      return null;
    }

    const participants = (await prisma.groupParticipant.findMany({
      where: {
        groupId,
        status: {
          in: [ParticipantStatus.ACTIVE, ParticipantStatus.PAUSED, ParticipantStatus.LEFT_GROUP],
        },
      },
      include: {
        user: true,
      },
    })).filter((participant) => {
      if (participant.status !== ParticipantStatus.LEFT_GROUP) {
        return true;
      }

      if (!participant.leftAt) {
        return false;
      }

      return startOfWeekLocal(participant.leftAt, group.settings!.timezone) === previousWeekStart;
    });
    const credits = await prisma.workoutDayCredit.findMany({
      where: {
        groupId,
        weekStartDateLocal: previousWeekStart,
      },
    });
    const completedSessions = await prisma.workoutSession.findMany({
      where: {
        groupId,
        status: SessionStatus.COMPLETED,
        durationMinutes: {
          not: null,
        },
        creditDateLocal: {
          gte: previousWeekStart,
          lte: previousWeekEnd,
        },
      },
      select: {
        userId: true,
        durationMinutes: true,
      },
    });
    const counts = new Map<string, number>();
    for (const credit of credits) {
      counts.set(credit.participantId, (counts.get(credit.participantId) ?? 0) + 1);
    }
    const minutesByUser = new Map<string, number>();
    for (const session of completedSessions) {
      minutesByUser.set(
        session.userId,
        (minutesByUser.get(session.userId) ?? 0) + (session.durationMinutes ?? 0),
      );
    }

    const ranked = rankLeaderboard(
      participants.map((participant) => ({
        participantId: participant.id,
        displayName: participant.user.displayName,
        completedDays: counts.get(participant.id) ?? 0,
        successfulWeekStreak: participant.currentSuccessfulWeekStreak,
        lifetimeCompletedDays: participant.lifetimeCompletedDays,
      })),
    );

    const participantTargets = new Map<string, number>();
    const rankedForDistribution = ranked.map((row) => {
      const participant = participants.find((entry) => entry.id === row.participantId);
      const effectiveTarget = getEffectiveWeeklyTarget({
        baseWeeklyTarget: group.settings!.weeklyTarget,
        participantJoinedDateLocal: participant?.joinedAt.toISOString().slice(0, 10) ?? null,
        participantJoinedWeekStartDateLocal: participant?.joinedWeekStartDateLocal ?? null,
        weekStartDateLocal: previousWeekStart,
      });

      participantTargets.set(row.participantId, effectiveTarget);

      return {
        participantId: row.participantId,
        displayName: row.displayName,
        completedDays: row.completedDays,
        metTarget: row.completedDays >= effectiveTarget,
      };
    });

    const leavePenaltyRows = await prisma.penaltyLedger.findMany({
      where: {
        groupId,
        type: PenaltyLedgerType.LEAVE_PENALTY,
        createdAt: {
          gte: new Date(`${previousWeekStart}T00:00:00.000Z`),
          lte: now,
        },
      },
      include: {
        user: true,
      },
    });

    const distribution = calculatePenaltyDistribution(
      rankedForDistribution,
      group.settings.weeklyTarget,
      group.settings.weeklyPenaltyAmount,
      leavePenaltyRows.reduce((sum, row) => sum + row.amount, 0),
    );

    const snapshot = await prisma.$transaction(async (tx) => {
      const createdSnapshot = await tx.weeklySnapshot.create({
        data: {
          groupId,
          weekStartDateLocal: previousWeekStart,
          weekEndDateLocal: previousWeekEnd,
          timezone: group.settings!.timezone,
          weeklyTarget: group.settings!.weeklyTarget,
          weeklyPenaltyAmount: group.settings!.weeklyPenaltyAmount,
          unresolvedPenaltyPool: distribution.unresolvedPenaltyPool,
        },
      });

      for (const [index, row] of ranked.entries()) {
        const participant = participants.find((entry) => entry.id === row.participantId);
        if (!participant) {
          continue;
        }

        const effectiveTarget = participantTargets.get(row.participantId) ?? group.settings!.weeklyTarget;
        const metTarget = row.completedDays >= effectiveTarget;
        const failed = !metTarget && participant.status === ParticipantStatus.ACTIVE;
        const failureRecord = distribution.failures.find((entry) => entry.participantId === participant.id);
        const earnRecord = distribution.earners.find((entry) => entry.participantId === participant.id);

        await tx.weeklyParticipantResult.create({
          data: {
            weeklySnapshotId: createdSnapshot.id,
            groupId,
            participantId: participant.id,
            userId: participant.userId,
            completedDays: row.completedDays,
            metTarget,
            workoutsLeftAtClose: Math.max(effectiveTarget - row.completedDays, 0),
            rank: index + 1,
            currentWorkoutDayStreak: participant.currentWorkoutDayStreak,
            currentSuccessfulWeekStreak: metTarget
              ? participant.currentSuccessfulWeekStreak + 1
              : 0,
            lifetimeCompletedDays: participant.lifetimeCompletedDays,
            totalSuccessfulWeeks: participant.totalSuccessfulWeeks + (metTarget ? 1 : 0),
            totalFailedWeeks: participant.totalFailedWeeks + (failed ? 1 : 0),
            penaltyOwed: failureRecord?.amountOwed ?? 0,
            penaltyEarned: earnRecord?.amountEarned ?? 0,
          },
        });

        await tx.groupParticipant.update({
          where: { id: participant.id },
          data: {
            currentSuccessfulWeekStreak: nextSuccessfulWeekStreak(
              participant.currentSuccessfulWeekStreak,
              metTarget,
            ),
            longestSuccessfulWeekStreak: metTarget
              ? Math.max(
                  participant.longestSuccessfulWeekStreak,
                  participant.currentSuccessfulWeekStreak + 1,
                )
              : participant.longestSuccessfulWeekStreak,
            totalSuccessfulWeeks: metTarget ? { increment: 1 } : undefined,
            totalFailedWeeks: failed ? { increment: 1 } : undefined,
            totalPenaltiesOwed: failureRecord ? { increment: failureRecord.amountOwed } : undefined,
            totalPenaltiesEarned: earnRecord ? { increment: earnRecord.amountEarned } : undefined,
          },
        });
      }

      for (const failure of distribution.failures) {
        const participant = participants.find((entry) => entry.id === failure.participantId);
        if (!participant) {
          continue;
        }

        await tx.penaltyLedger.create({
          data: {
            groupId,
            weeklySnapshotId: createdSnapshot.id,
            userId: participant.userId,
            type: distribution.unresolvedPenaltyPool > 0 ? PenaltyLedgerType.UNRESOLVED : PenaltyLedgerType.OWED,
            amount: failure.amountOwed,
            description:
              distribution.unresolvedPenaltyPool > 0
                ? `Unresolved weekly penalty for ${previousWeekStart}`
                : `Weekly penalty owed for ${previousWeekStart}`,
          },
        });
      }

      for (const earn of distribution.earners) {
        const participant = participants.find((entry) => entry.id === earn.participantId);
        if (!participant) {
          continue;
        }

        await tx.penaltyLedger.create({
          data: {
            groupId,
            weeklySnapshotId: createdSnapshot.id,
            userId: participant.userId,
            type: PenaltyLedgerType.EARNED,
            amount: earn.amountEarned,
            description: `Weekly reward earned for ${previousWeekStart}`,
          },
        });
      }

      await tx.scheduledJobLog.create({
        data: {
          groupId,
          jobType: ScheduledJobType.WEEKLY_SUMMARY,
          jobKey,
          runAtUtc: now,
          status: ScheduledJobStatus.SUCCEEDED,
          message: `Weekly summary created for ${previousWeekStart}`,
        },
      });

      return createdSnapshot;
    });

    const resultRows = await prisma.weeklyParticipantResult.findMany({
      where: { weeklySnapshotId: snapshot.id },
      include: { user: true },
      orderBy: { rank: 'asc' },
    });

    const medalRows = resultRows
      .map((row) => ({
        ...row,
        totalMinutes: minutesByUser.get(row.userId) ?? 0,
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

    const lines = [
      `*Weekly summary*`,
      `${snapshot.weekStartDateLocal} to ${snapshot.weekEndDateLocal}`,
      '',
      '*Hours podium*',
      ...medalRows.slice(0, 3).map((row, index) => `${this.medalFor(index)} ${row.user.displayName} ${this.formatHours(row.totalMinutes)}`),
      '',
      '*Weekly rankings*',
      ...medalRows.map(
        (row, index) =>
          formatRankingLine({
            rankLabel: this.rankLabel(index),
            displayName: row.user.displayName,
            completedDays: row.completedDays,
            weeklyTarget: snapshot.weeklyTarget,
            currentWorkoutDayStreak: row.currentWorkoutDayStreak,
            lifetimeCompletedDays: row.lifetimeCompletedDays,
            totalMinutes: row.totalMinutes,
          }),
      ),
      '',
      `Hit target: ${resultRows.filter((row) => row.metTarget).map((row) => row.user.displayName).join(', ') || 'Nobody'}`,
      `Missed target: ${resultRows.filter((row) => !row.metTarget).map((row) => row.user.displayName).join(', ') || 'Nobody'}`,
    ];

    if (snapshot.unresolvedPenaltyPool > 0) {
      lines.push(`Penalty unresolved: ${snapshot.unresolvedPenaltyPool} baht. Nobody hit target.`);
    } else {
      lines.push(
        ...leavePenaltyRows.map((row) => `${row.user?.displayName ?? 'Unknown'} leave penalty: ${row.amount} baht`),
        ...distribution.failures.map((row) => `${row.displayName} owes ${row.amountOwed} baht`),
        ...distribution.earners.map((row) => `${row.displayName} earns ${row.amountEarned} baht`),
      );
    }

    return lines.join('\n');
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

  private rankLabel(index: number): string {
    return this.medalFor(index);
  }

  private formatHours(totalMinutes: number): string {
    return `${(totalMinutes / 60).toFixed(1)}h`;
  }

  async buildWeekResultsAnnouncement(groupId: string, weekStartDateLocal: string): Promise<string | null> {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { settings: true },
    });
    if (!group?.settings) {
      return null;
    }

    const snapshot = await prisma.weeklySnapshot.findFirst({
      where: { groupId, weekStartDateLocal },
      include: {
        results: {
          include: { user: true },
          orderBy: { completedDays: 'desc' },
        },
      },
    });

    if (snapshot) {
      const winners = snapshot.results.filter((r) => r.metTarget);
      const losers = snapshot.results.filter((r) => !r.metTarget);

      const lines = [
        `*Week of ${snapshot.weekStartDateLocal} — Results*`,
        '',
      ];

      if (winners.length > 0) {
        lines.push('✅ *Hit target:*');
        for (const w of winners) {
          lines.push(`${w.user.displayName} — ${w.completedDays}/${snapshot.weeklyTarget}`);
        }
        lines.push('');
      }

      if (losers.length > 0) {
        lines.push('❌ *Missed target:*');
        for (const l of losers) {
          lines.push(`${l.user.displayName} — ${l.completedDays}/${snapshot.weeklyTarget}`);
        }
        lines.push('');
      }

      if (losers.length > 0 && winners.length > 0) {
        const penalty = snapshot.weeklyPenaltyAmount;
        const split = Math.floor((losers.length * penalty) / winners.length);
        lines.push('💰 *Penalties:*');
        for (const l of losers) {
          lines.push(`${l.user.displayName} owes ${penalty} baht`);
        }
        lines.push('');
        lines.push(`Winners split the pool: ${winners.map((w) => w.user.displayName).join(', ')} each earn ~${split} baht`);
      } else if (losers.length > 0) {
        lines.push('💰 *Penalties:*');
        for (const l of losers) {
          lines.push(`${l.user.displayName} owes ${snapshot.weeklyPenaltyAmount} baht (pool unresolved — no winners)`);
        }
      }

      return lines.join('\n');
    }

    const participants = (await prisma.groupParticipant.findMany({
      where: {
        groupId,
        status: {
          in: [ParticipantStatus.ACTIVE, ParticipantStatus.PAUSED, ParticipantStatus.LEFT_GROUP],
        },
      },
      include: { user: true },
    })).filter((participant) => {
      if (participant.status !== ParticipantStatus.LEFT_GROUP) {
        return true;
      }
      if (!participant.leftAt) {
        return false;
      }
      return startOfWeekLocal(participant.leftAt, group.settings!.timezone) === weekStartDateLocal;
    });

    const credits = await prisma.workoutDayCredit.findMany({
      where: { groupId, weekStartDateLocal },
    });

    const counts = new Map<string, number>();
    for (const credit of credits) {
      counts.set(credit.participantId, (counts.get(credit.participantId) ?? 0) + 1);
    }

    const winners: Array<{ name: string; completed: number; target: number }> = [];
    const losers: Array<{ name: string; completed: number; target: number }> = [];

    for (const participant of participants) {
      const completed = counts.get(participant.id) ?? 0;
      const target = getEffectiveWeeklyTarget({
        baseWeeklyTarget: group.settings.weeklyTarget,
        participantJoinedDateLocal: participant.joinedAt.toISOString().slice(0, 10),
        participantJoinedWeekStartDateLocal: participant.joinedWeekStartDateLocal,
        weekStartDateLocal,
      });
      const name = participant.user.username ? `@${participant.user.username}` : participant.user.displayName;
      if (completed >= target) {
        winners.push({ name, completed, target });
      } else {
        losers.push({ name, completed, target });
      }
    }

    const lines = [
      `*Week of ${weekStartDateLocal} — Results*`,
      '',
    ];

    if (winners.length > 0) {
      lines.push('✅ *Hit target:*');
      for (const w of winners) {
        lines.push(`${w.name} — ${w.completed}/${w.target}`);
      }
      lines.push('');
    }

    if (losers.length > 0) {
      lines.push('❌ *Missed target:*');
      for (const l of losers) {
        lines.push(`${l.name} — ${l.completed}/${l.target}`);
      }
      lines.push('');
    }

    if (losers.length > 0 && winners.length > 0) {
      const penalty = group.settings.weeklyPenaltyAmount;
      const split = Math.floor((losers.length * penalty) / winners.length);
      lines.push('💰 *Penalties:*');
      for (const l of losers) {
        lines.push(`${l.name} owes ${penalty} baht`);
      }
      lines.push('');
      lines.push(`Winners split the pool: ${winners.map((w) => w.name).join(', ')} each earn ~${split} baht`);
    } else if (losers.length > 0) {
      lines.push('💰 *Penalties:*');
      for (const l of losers) {
        lines.push(`${l.name} owes ${group.settings.weeklyPenaltyAmount} baht (pool unresolved — no winners)`);
      }
    }

    return lines.join('\n');
  }

  async resetCurrentWeek(groupId: string, now: Date): Promise<void> {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { settings: true },
    });
    if (!group?.settings) {
      return;
    }

    const currentWeekStart = startOfWeekLocal(now, group.settings.timezone);
    const jobKey = currentWeekStart;
    const existing = await prisma.scheduledJobLog.findUnique({
      where: {
        groupId_jobType_jobKey: {
          groupId,
          jobType: ScheduledJobType.WEEKLY_RESET,
          jobKey,
        },
      },
    });
    if (existing) {
      return;
    }

    await prisma.scheduledJobLog.create({
      data: {
        groupId,
        jobType: ScheduledJobType.WEEKLY_RESET,
        jobKey,
        runAtUtc: now,
        status: ScheduledJobStatus.SUCCEEDED,
        message: `Week boundary acknowledged for ${currentWeekStart}`,
      },
    });
  }
}
