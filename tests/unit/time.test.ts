import { describe, expect, it } from 'vitest';

import { getWeekToSummarizeStart, localDate, startOfWeekLocal } from '../../src/domain/time.js';

describe('timezone-sensitive week logic', () => {
  it('credits the check-in date even when check-out crosses midnight in Bangkok', () => {
    expect(localDate('2026-03-29T16:30:00.000Z', 'Asia/Bangkok')).toBe('2026-03-29');
    expect(localDate('2026-03-29T18:10:00.000Z', 'Asia/Bangkok')).toBe('2026-03-30');
  });

  it('starts the local week on Monday', () => {
    expect(startOfWeekLocal('2026-03-29T16:30:00.000Z', 'Asia/Bangkok')).toBe('2026-03-23');
    expect(startOfWeekLocal('2026-03-29T17:30:00.000Z', 'Asia/Bangkok')).toBe('2026-03-30');
  });

  it('summarizes the current local week before Monday starts', () => {
    expect(getWeekToSummarizeStart(new Date('2026-04-05T16:59:00.000Z'), 'Asia/Bangkok')).toBe('2026-03-30');
  });

  it('summarizes the prior local week once Monday has started', () => {
    expect(getWeekToSummarizeStart(new Date('2026-04-05T17:00:00.000Z'), 'Asia/Bangkok')).toBe('2026-03-30');
  });
});
