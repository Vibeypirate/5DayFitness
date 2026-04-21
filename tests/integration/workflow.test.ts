import { describe, expect, it } from 'vitest';

import { rankLeaderboard } from '../../src/domain/leaderboard.js';
import { calculatePenaltyDistribution } from '../../src/domain/penalties.js';
import { applyWorkoutDayStreak } from '../../src/domain/streaks.js';
import { startOfWeekLocal, localDate, minutesBetween } from '../../src/domain/time.js';
import { validateCheckIn, validateCheckOut } from '../../src/domain/workout.js';

describe('check-in/check-out flow', () => {
  it('completes a session, credits the check-in day, and updates streaks', () => {
    const checkInAt = new Date('2026-03-30T12:00:00.000Z');
    const checkOutAt = new Date('2026-03-30T13:00:00.000Z');
    const creditDate = localDate(checkInAt.toISOString(), 'Asia/Bangkok');

    expect(
      validateCheckIn({ hasPhoto: true, matchedTrigger: true, hasOpenSession: false }),
    ).toBeNull();
    expect(
      validateCheckOut({
        hasPhoto: true,
        matchedTrigger: true,
        openSessionExists: true,
        alreadyCreditedToday: false,
        minSessionMinutes: 20,
        checkedInAtUtc: checkInAt,
        checkedOutAtUtc: checkOutAt,
      }),
    ).toBeNull();
    expect(minutesBetween(checkInAt, checkOutAt)).toBe(60);
    expect(creditDate).toBe('2026-03-30');
    expect(applyWorkoutDayStreak(2, 2, '2026-03-29', creditDate)).toEqual({
      currentStreak: 3,
      longestStreak: 3,
    });
  });
});

describe('scheduled weekly summary generation', () => {
  it('builds final rankings and payout results', () => {
    const ranked = rankLeaderboard([
      {
        participantId: 'indy',
        displayName: 'Indy',
        completedDays: 5,
        successfulWeekStreak: 2,
        lifetimeCompletedDays: 40,
      },
      {
        participantId: 'max',
        displayName: 'Max',
        completedDays: 6,
        successfulWeekStreak: 1,
        lifetimeCompletedDays: 20,
      },
      {
        participantId: 'lee',
        displayName: 'Lee',
        completedDays: 4,
        successfulWeekStreak: 5,
        lifetimeCompletedDays: 50,
      },
    ]);

    const penalties = calculatePenaltyDistribution(
      ranked.map((row) => ({
        participantId: row.participantId,
        displayName: row.displayName,
        completedDays: row.completedDays,
      })),
      5,
      1000,
    );

    expect(ranked.map((row) => row.participantId)).toEqual(['max', 'indy', 'lee']);
    expect(penalties.failures).toEqual([{ participantId: 'lee', displayName: 'Lee', amountOwed: 1000 }]);
    expect(penalties.earners).toEqual([
      { participantId: 'max', displayName: 'Max', amountEarned: 500 },
      { participantId: 'indy', displayName: 'Indy', amountEarned: 500 },
    ]);
  });
});

describe('admin override flow', () => {
  it('credits the overridden date into the correct local week', () => {
    const creditDate = '2026-03-31';
    const weekStart = startOfWeekLocal(`${creditDate}T12:00:00.000Z`, 'Asia/Bangkok');

    expect(weekStart).toBe('2026-03-30');
  });
});
