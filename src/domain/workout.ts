import { minutesBetween } from './time.js';

export type StartWorkoutInput = {
  hasPhoto: boolean;
  matchedTrigger: boolean;
  hasOpenSession: boolean;
};

export type FinishWorkoutInput = {
  hasPhoto: boolean;
  matchedTrigger: boolean;
  openSessionExists: boolean;
  alreadyCreditedToday: boolean;
  minSessionMinutes: number;
  checkedInAtUtc?: Date;
  checkedOutAtUtc?: Date;
};

export function validateCheckIn(input: StartWorkoutInput): string | null {
  if (!input.matchedTrigger) {
    return null;
  }

  if (!input.hasPhoto) {
    return 'A photo is required for check-in.';
  }

  if (input.hasOpenSession) {
    return 'You already have an open workout session. Check out before starting another one.';
  }

  return null;
}

export function validateCheckOut(input: FinishWorkoutInput): string | null {
  if (!input.matchedTrigger) {
    return null;
  }

  if (!input.hasPhoto) {
    return 'A photo is required for check-out.';
  }

  if (!input.openSessionExists) {
    return 'Checkout rejected. No active check-in found.';
  }

  if (!input.checkedInAtUtc || !input.checkedOutAtUtc) {
    return 'Checkout rejected. Session timestamps are incomplete.';
  }

  const duration = minutesBetween(input.checkedInAtUtc, input.checkedOutAtUtc);
  if (duration < input.minSessionMinutes) {
    return `This session was too short to count. Minimum duration is ${input.minSessionMinutes} minutes.`;
  }

  const ageHours = (input.checkedOutAtUtc.getTime() - input.checkedInAtUtc.getTime()) / 3600000;
  if (ageHours > 24) {
    return 'Checkout rejected. Check-out must happen within 24 hours of check-in.';
  }

  if (input.alreadyCreditedToday) {
    return 'Today is already counted. You can still check out, but it will not add another workout day.';
  }

  return null;
}

export function shouldCreditWorkoutDay(alreadyCreditedToday: boolean): boolean {
  return !alreadyCreditedToday;
}
