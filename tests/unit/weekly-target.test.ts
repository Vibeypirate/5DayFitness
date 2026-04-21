import { describe, expect, it } from 'vitest';

import { getEffectiveWeeklyTarget } from '../../src/domain/weekly-target.js';

describe('effective weekly target', () => {
  it('uses reduced target for the participant join week only', () => {
    expect(
      getEffectiveWeeklyTarget({
        baseWeeklyTarget: 5,
        participantJoinedDateLocal: '2026-04-22',
        participantJoinedWeekStartDateLocal: '2026-04-20',
        weekStartDateLocal: '2026-04-20',
      }),
    ).toBe(2);

    expect(
      getEffectiveWeeklyTarget({
        baseWeeklyTarget: 5,
        participantJoinedDateLocal: '2026-04-22',
        participantJoinedWeekStartDateLocal: '2026-04-20',
        weekStartDateLocal: '2026-04-27',
      }),
    ).toBe(5);
  });
});
