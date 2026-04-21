import { ParticipantStatus, ScheduledJobStatus, type ScheduledJobType } from '@prisma/client';

import { prisma } from '../db.js';
import { localDate, startOfWeekLocal } from '../domain/time.js';

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
    const stillMissing = participants.filter((participant) => !creditedToday.has(participant.id));

    if (stillMissing.length === 0) {
      return null;
    }

    return [
      '*Reminder*',
      'Still missing a workout today:',
      ...stillMissing.map((participant) =>
        participant.user.username ? `@${participant.user.username}` : participant.user.displayName,
      ),
      '',
      `Target is ${weeklyTarget} this week. Don't donate ${settings?.weeklyPenaltyAmount ?? 1000} baht for free.`,
    ].join('\n');
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
