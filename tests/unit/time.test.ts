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

  it('returns correct local date for just after midnight', () => {
    // 2024-01-02T00:15:00 in Asia/Bangkok = 2024-01-01T17:15:00Z
    expect(localDate('2024-01-01T17:15:00.000Z', 'Asia/Bangkok')).toBe('2024-01-02');
  });

  it('returns correct local date for just before midnight', () => {
    // 2024-01-01T23:59:00 in Asia/Bangkok = 2024-01-01T16:59:00Z
    expect(localDate('2024-01-01T16:59:00.000Z', 'Asia/Bangkok')).toBe('2024-01-01');
  });

  it('handles week boundary at midnight Sunday-Monday', () => {
    // Monday 00:15 in Asia/Bangkok = Sunday 17:15 UTC
    expect(localDate('2024-01-07T17:15:00.000Z', 'Asia/Bangkok')).toBe('2024-01-08');
    expect(startOfWeekLocal('2024-01-07T17:15:00.000Z', 'Asia/Bangkok')).toBe('2024-01-08');
  });
});
