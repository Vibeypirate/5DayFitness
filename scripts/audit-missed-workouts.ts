import { PrismaClient, ParticipantStatus } from '@prisma/client';
import { startOfWeekLocal } from '../src/domain/time.js';
import { getEffectiveWeeklyTarget } from '../src/domain/weekly-target.js';

const prisma = new PrismaClient();

async function main() {
  const groups = await prisma.group.findMany({
    where: { isActive: true },
    include: { settings: true },
  });

  for (const group of groups) {
    if (!group.settings) {
      continue;
    }

    console.log(`\n=== Group: ${group.telegramTitle} ===`);

    const participants = await prisma.groupParticipant.findMany({
      where: {
        groupId: group.id,
        status: ParticipantStatus.ACTIVE,
      },
      include: { user: true },
    });

    if (participants.length === 0) {
      console.log('No active participants.');
      continue;
    }

    // Find all distinct week start dates that have credits for this group
    const creditWeeks = await prisma.workoutDayCredit.findMany({
      where: { groupId: group.id },
      select: { weekStartDateLocal: true },
      distinct: ['weekStartDateLocal'],
      orderBy: { weekStartDateLocal: 'asc' },
    });

    const weeksToCheck = creditWeeks.map((c) => c.weekStartDateLocal);

    // Also check the current week even if there are no credits yet
    const currentWeekStart = startOfWeekLocal(new Date(), group.settings.timezone);
    if (!weeksToCheck.includes(currentWeekStart)) {
      weeksToCheck.push(currentWeekStart);
    }

    for (const weekStart of weeksToCheck) {
      const credits = await prisma.workoutDayCredit.findMany({
        where: {
          groupId: group.id,
          weekStartDateLocal: weekStart,
        },
      });

      const creditsByParticipant = new Map<string, number>();
      for (const credit of credits) {
        creditsByParticipant.set(credit.participantId, (creditsByParticipant.get(credit.participantId) ?? 0) + 1);
      }

      const behind: Array<{ name: string; completed: number; target: number }> = [];

      for (const participant of participants) {
        const completed = creditsByParticipant.get(participant.id) ?? 0;
        const target = getEffectiveWeeklyTarget({
          baseWeeklyTarget: group.settings.weeklyTarget,
          participantJoinedDateLocal: participant.joinedAt.toISOString().slice(0, 10),
          participantJoinedWeekStartDateLocal: participant.joinedWeekStartDateLocal,
          weekStartDateLocal: weekStart,
        });
        const name = participant.user.username ?? participant.user.displayName;

        if (completed < target) {
          behind.push({ name, completed, target });
        }
      }

      if (behind.length > 0) {
        console.log(`\nWeek ${weekStart}:`);
        for (const row of behind) {
          console.log(`  - ${row.name}: ${row.completed}/${row.target} (missed ${row.target - row.completed})`);
        }
      }
    }
  }

  console.log('\n=== Audit complete ===\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
