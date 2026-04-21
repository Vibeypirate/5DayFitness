import { stringify } from 'csv-stringify/sync';

import { prisma } from '../db.js';

export class ExportService {
  async exportGroupCsv(groupId: string): Promise<string> {
    const participants = await prisma.groupParticipant.findMany({
      where: { groupId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });

    return stringify(
      participants.map((row) => ({
        displayName: row.user.displayName,
        username: row.user.username ?? '',
        status: row.status,
        lifetimeCompletedDays: row.lifetimeCompletedDays,
        currentWorkoutDayStreak: row.currentWorkoutDayStreak,
        currentSuccessfulWeekStreak: row.currentSuccessfulWeekStreak,
        totalSuccessfulWeeks: row.totalSuccessfulWeeks,
        totalFailedWeeks: row.totalFailedWeeks,
        totalPenaltiesOwed: row.totalPenaltiesOwed,
        totalPenaltiesEarned: row.totalPenaltiesEarned,
      })),
      { header: true },
    );
  }
}
