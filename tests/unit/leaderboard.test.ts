import { describe, expect, it } from 'vitest';

import {
  formatNetBalanceLine,
  formatRankingLine,
  formatWeekProgressLine,
  rankLeaderboard,
} from '../../src/domain/leaderboard.js';

describe('leaderboard ranking', () => {
  it('ranks by weekly days, then successful-week streak, then lifetime days', () => {
    const ranked = rankLeaderboard([
      {
        participantId: 'a',
        displayName: 'A',
        completedDays: 4,
        successfulWeekStreak: 3,
        lifetimeCompletedDays: 10,
      },
      {
        participantId: 'b',
        displayName: 'B',
        completedDays: 5,
        successfulWeekStreak: 1,
        lifetimeCompletedDays: 2,
      },
      {
        participantId: 'c',
        displayName: 'C',
        completedDays: 4,
        successfulWeekStreak: 4,
        lifetimeCompletedDays: 9,
      },
    ]);

    expect(ranked.map((row) => row.participantId)).toEqual(['b', 'c', 'a']);
  });

  it('formats weekly days, daily streak, total days, and total hours together', () => {
    expect(
      formatRankingLine({
        rankLabel: '1.',
        displayName: 'Jazz',
        completedDays: 4,
        weeklyTarget: 5,
        currentWorkoutDayStreak: 0,
        lifetimeCompletedDays: 18,
        totalMinutes: 375,
      }),
    ).toBe('1. Jazz 4/5 days | streak 0 | total 18 days | 6.3h');
  });

  it('formats current progress against an effective target', () => {
    expect(formatWeekProgressLine(2, 2)).toBe('This week: 2/2');
  });

  it('formats net balance with the correct sign', () => {
    expect(formatNetBalanceLine(-667)).toBe('Net balance: -667 baht');
  });
});
