import { describe, expect, it } from 'vitest';

import { shouldCreditWorkoutDay, validateCheckIn, validateCheckOut } from '../../src/domain/workout.js';

describe('workout validation', () => {
  it('rejects check-in without photo', () => {
    expect(
      validateCheckIn({
        hasPhoto: false,
        matchedTrigger: true,
        hasOpenSession: false,
      }),
    ).toBe('A photo is required for check-in.');
  });

  it('rejects instant check-out', () => {
    expect(
      validateCheckOut({
        hasPhoto: true,
        matchedTrigger: true,
        openSessionExists: true,
        alreadyCreditedToday: false,
        minSessionMinutes: 20,
        checkedInAtUtc: new Date('2026-03-30T10:00:00.000Z'),
        checkedOutAtUtc: new Date('2026-03-30T10:10:00.000Z'),
      }),
    ).toContain('Minimum duration is 20 minutes');
  });

  it('credits a day only once', () => {
    expect(shouldCreditWorkoutDay(false)).toBe(true);
    expect(shouldCreditWorkoutDay(true)).toBe(false);
  });
});
