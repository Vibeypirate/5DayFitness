import { describe, expect, it } from 'vitest';

import { applyWorkoutDayStreak, nextSuccessfulWeekStreak } from '../../src/domain/streaks.js';

describe('streak calculations', () => {
  it('extends a daily streak on consecutive dates', () => {
    expect(applyWorkoutDayStreak(3, 4, '2026-03-29', '2026-03-30')).toEqual({
      currentStreak: 4,
      longestStreak: 4,
    });
  });

  it('resets a daily streak after a missed day', () => {
    expect(applyWorkoutDayStreak(3, 4, '2026-03-27', '2026-03-30')).toEqual({
      currentStreak: 1,
      longestStreak: 4,
    });
  });

  it('increments or resets successful-week streaks', () => {
    expect(nextSuccessfulWeekStreak(2, true)).toBe(3);
    expect(nextSuccessfulWeekStreak(2, false)).toBe(0);
  });
});
