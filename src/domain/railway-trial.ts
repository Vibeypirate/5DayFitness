import { DateTime } from 'luxon';

import { localDate } from './time.js';

export type RailwayTrialReminderInput = {
  now: Date;
  timezone: string;
  trialEndDate: string;
  balanceRemaining?: string;
  reminderDays: number[];
  testPrefix?: string;
};

export type RailwayTrialReminderResult = {
  daysLeft: number;
  message: string;
};

export function buildRailwayTrialReminder(
  input: RailwayTrialReminderInput,
): string | null {
  return buildRailwayTrialReminderResult(input)?.message ?? null;
}

export function buildRailwayTrialReminderResult(
  input: RailwayTrialReminderInput,
): RailwayTrialReminderResult | null {
  const daysLeft = daysUntilLocalDate(input.now, input.timezone, input.trialEndDate);
  if (!input.reminderDays.includes(daysLeft)) {
    return null;
  }

  const prefix = input.testPrefix ? `${input.testPrefix} ` : '';
  const balanceLine = input.balanceRemaining
    ? [`Balance remaining: ${input.balanceRemaining}.`]
    : [];

  return {
    daysLeft,
    message: [
      `*${prefix}Railway trial reminder*`,
      `${daysLeft} day${daysLeft === 1 ? '' : 's'} left on Railway trial.`,
      ...balanceLine,
    ].join('\n'),
  };
}

function daysUntilLocalDate(now: Date, timezone: string, targetDate: string): number {
  const today = DateTime.fromISO(localDate(now, timezone), { zone: timezone }).startOf('day');
  const target = DateTime.fromISO(targetDate, { zone: timezone }).startOf('day');
  return Math.floor(target.diff(today, 'days').days);
}
