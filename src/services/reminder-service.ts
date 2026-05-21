import { ParticipantStatus, ScheduledJobStatus, type ScheduledJobType } from '@prisma/client';
import { DateTime } from 'luxon';

import { prisma } from '../db.js';
import { localDate, startOfWeekLocal } from '../domain/time.js';
import { getEffectiveWeeklyTarget } from '../domain/weekly-target.js';

export class ReminderService {
  async buildReminder(groupId: string, timezone: string, weeklyTarget: number, now: Date): Promise<string | null> {
    const today = localDate(now, timezone);
    const weekStart = startOfWeekLocal(now, timezone);

    const [participants, credits, settings] = await Promise.all([
      prisma.groupParticipant.findMany({
        where: {
          groupId,
          status: ParticipantStatus.ACTIVE,
        },
        include: {
          user: true,
        },
      }),
      prisma.workoutDayCredit.findMany({
        where: {
          groupId,
          weekStartDateLocal: weekStart,
        },
      }),
      prisma.groupSettings.findUnique({
        where: { groupId },
        select: { weeklyPenaltyAmount: true },
      }),
    ]);

    const creditedToday = new Set(
      credits.filter((credit) => credit.creditDateLocal === today).map((credit) => credit.participantId),
    );

    const creditsByParticipant = new Map<string, number>();
    for (const credit of credits) {
      creditsByParticipant.set(credit.participantId, (creditsByParticipant.get(credit.participantId) ?? 0) + 1);
    }

    const stillMissing = participants.filter((participant) => {
      if (creditedToday.has(participant.id)) {
        return false;
      }
      const completedDays = creditsByParticipant.get(participant.id) ?? 0;
      const effectiveTarget = getEffectiveWeeklyTarget({
        baseWeeklyTarget: weeklyTarget,
        participantJoinedDateLocal: participant.joinedAt.toISOString().slice(0, 10),
        participantJoinedWeekStartDateLocal: participant.joinedWeekStartDateLocal,
        weekStartDateLocal: weekStart,
      });
      return completedDays < effectiveTarget;
    });

    if (stillMissing.length === 0) {
      return null;
    }

    return [
      '*Reminder*',
      'Still missing a workout today:',
      ...stillMissing.map((participant) => {
        const completedDays = creditsByParticipant.get(participant.id) ?? 0;
        const effectiveTarget = getEffectiveWeeklyTarget({
          baseWeeklyTarget: weeklyTarget,
          participantJoinedDateLocal: participant.joinedAt.toISOString().slice(0, 10),
          participantJoinedWeekStartDateLocal: participant.joinedWeekStartDateLocal,
          weekStartDateLocal: weekStart,
        });
        const name = participant.user.username ? `@${participant.user.username}` : participant.user.displayName;
        return `${name} — ${completedDays}/${effectiveTarget}`;
      }),
      '',
      `Don't donate ${settings?.weeklyPenaltyAmount ?? 1000} baht for free.`,
    ].join('\n');
  }

  async buildWeekAudit(groupId: string, timezone: string, weeklyTarget: number, now: Date): Promise<string | null> {
    const weekStart = startOfWeekLocal(now, timezone);

    const [participants, credits, settings] = await Promise.all([
      prisma.groupParticipant.findMany({
        where: {
          groupId,
          status: ParticipantStatus.ACTIVE,
        },
        include: {
          user: true,
        },
      }),
      prisma.workoutDayCredit.findMany({
        where: {
          groupId,
          weekStartDateLocal: weekStart,
        },
      }),
      prisma.groupSettings.findUnique({
        where: { groupId },
        select: { weeklyPenaltyAmount: true },
      }),
    ]);

    if (participants.length === 0) {
      return null;
    }

    const creditsByParticipant = new Map<string, number>();
    for (const credit of credits) {
      creditsByParticipant.set(credit.participantId, (creditsByParticipant.get(credit.participantId) ?? 0) + 1);
    }

    const behind: Array<{ name: string; completed: number; target: number }> = [];
    const onTrack: Array<{ name: string; completed: number; target: number }> = [];

    for (const participant of participants) {
      const completed = creditsByParticipant.get(participant.id) ?? 0;
      const target = getEffectiveWeeklyTarget({
        baseWeeklyTarget: weeklyTarget,
        participantJoinedDateLocal: participant.joinedAt.toISOString().slice(0, 10),
        participantJoinedWeekStartDateLocal: participant.joinedWeekStartDateLocal,
        weekStartDateLocal: weekStart,
      });
      const name = participant.user.username ? `@${participant.user.username}` : participant.user.displayName;

      if (completed < target) {
        behind.push({ name, completed, target });
      } else {
        onTrack.push({ name, completed, target });
      }
    }

    const todayDt = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(timezone);
    const daysRemaining = 8 - todayDt.weekday;

    const lines = [
      '*Week audit*',
      `Week: ${weekStart} — ${todayDt.endOf('week').toISODate()}`,
      '',
    ];

    if (behind.length > 0) {
      lines.push('*Behind target:*');
      for (const row of behind) {
        lines.push(`${row.name} — ${row.completed}/${row.target} (needs ${row.target - row.completed} more)`);
      }
      lines.push('');
    }

    if (onTrack.length > 0) {
      lines.push('*On track:*');
      for (const row of onTrack) {
        lines.push(`${row.name} — ${row.completed}/${row.target}${row.completed > row.target ? ' 🔥' : ' ✅'}`);
      }
      lines.push('');
    }

    lines.push(`Days remaining this week: ${daysRemaining}`);
    lines.push(`Penalty at stake: ${settings?.weeklyPenaltyAmount ?? 1000} baht`);

    return lines.join('\n');
  }

  async recordReminder(groupId: string, jobType: ScheduledJobType, jobKey: string, now: Date, message: string): Promise<boolean> {
    try {
      await prisma.scheduledJobLog.create({
        data: {
          groupId,
          jobType,
          jobKey,
          runAtUtc: now,
          status: ScheduledJobStatus.SUCCEEDED,
          message,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  buildNewDayMessage(weeklyTarget: number): string {
    return [
      '*New day*',
      'The clock has reset.',
      'You now have the next 24 hours to lock in today\'s workout.',
      `Weekly target stays at ${weeklyTarget}.`,
    ].join('\n');
  }
}
