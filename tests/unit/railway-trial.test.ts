import { describe, expect, it } from 'vitest';

import { buildRailwayTrialReminder } from '../../src/domain/railway-trial.js';

describe('Railway trial reminders', () => {
  it('builds a TEST-tagged status message with 15 days remaining and current balance', () => {
    expect(
      buildRailwayTrialReminder({
        now: new Date('2026-04-15T05:00:00.000Z'),
        timezone: 'Asia/Bangkok',
        trialEndDate: '2026-04-30',
        balanceRemaining: '$4.19',
        reminderDays: [15, 2, 1],
        testPrefix: 'TEST',
      }),
    ).toBe('*TEST Railway trial reminder*\n15 days left on Railway trial.\nBalance remaining: $4.19.');
  });

  it('builds reminders for the final two days', () => {
    expect(
      buildRailwayTrialReminder({
        now: new Date('2026-04-28T05:00:00.000Z'),
        timezone: 'Asia/Bangkok',
        trialEndDate: '2026-04-30',
        balanceRemaining: '$4.19',
        reminderDays: [15, 2, 1],
        testPrefix: 'TEST',
      }),
    ).toContain('2 days left');
  });

  it('skips days that are not configured reminder days', () => {
    expect(
      buildRailwayTrialReminder({
        now: new Date('2026-04-20T05:00:00.000Z'),
        timezone: 'Asia/Bangkok',
        trialEndDate: '2026-04-30',
        balanceRemaining: '$4.19',
        reminderDays: [15, 2, 1],
        testPrefix: 'TEST',
      }),
    ).toBeNull();
  });
});
