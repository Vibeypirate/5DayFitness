import { DateTime } from 'luxon';

export function toGroupTime(value: Date | string, timezone: string): DateTime {
  const input = typeof value === 'string' ? DateTime.fromISO(value, { zone: 'utc' }) : DateTime.fromJSDate(value, { zone: 'utc' });
  return input.setZone(timezone);
}

export function localDate(value: Date | string, timezone: string): string {
  return toGroupTime(value, timezone).toISODate()!;
}

export function startOfWeekLocal(value: Date | string, timezone: string): string {
  return toGroupTime(value, timezone).startOf('week').toISODate()!;
}

export function endOfWeekLocal(value: Date | string, timezone: string): string {
  return toGroupTime(value, timezone).endOf('week').toISODate()!;
}

export function minutesBetween(startUtc: Date, endUtc: Date): number {
  return Math.floor((endUtc.getTime() - startUtc.getTime()) / 60000);
}

export function parseClockToDate(now: Date, timezone: string, hhmm: string): Date {
  const [hour, minute] = hhmm.split(':').map(Number);
  const local = toGroupTime(now, timezone).set({ hour, minute, second: 0, millisecond: 0 });
  return local.toUTC().toJSDate();
}

export function isSameLocalDate(dateA: Date | string, dateB: Date | string, timezone: string): boolean {
  return localDate(dateA, timezone) === localDate(dateB, timezone);
}

export function getPreviousWeekStart(reference: Date, timezone: string): string {
  return toGroupTime(reference, timezone).minus({ weeks: 1 }).startOf('week').toISODate()!;
}

export function getWeekToSummarizeStart(reference: Date, timezone: string): string {
  const local = toGroupTime(reference, timezone);
  if (local.weekday === 7) {
    return local.startOf('week').toISODate()!;
  }

  return local.minus({ weeks: 1 }).startOf('week').toISODate()!;
}
