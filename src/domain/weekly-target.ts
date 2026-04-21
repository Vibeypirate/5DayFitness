const JOIN_WEEK_TARGET_BY_WEEKDAY: Record<number, number> = {
  1: 4,
  2: 3,
  3: 2,
  4: 2,
  5: 2,
  6: 1,
  7: 1,
};

export function getEffectiveWeeklyTarget(input: {
  baseWeeklyTarget: number;
  participantJoinedDateLocal: string | null;
  participantJoinedWeekStartDateLocal: string | null;
  weekStartDateLocal: string;
}): number {
  if (
    !input.participantJoinedDateLocal ||
    !input.participantJoinedWeekStartDateLocal ||
    input.participantJoinedWeekStartDateLocal !== input.weekStartDateLocal
  ) {
    return input.baseWeeklyTarget;
  }

  const weekday = new Date(`${input.participantJoinedDateLocal}T00:00:00.000Z`).getUTCDay();
  const normalizedWeekday = weekday === 0 ? 7 : weekday;

  return Math.min(
    input.baseWeeklyTarget,
    JOIN_WEEK_TARGET_BY_WEEKDAY[normalizedWeekday] ?? input.baseWeeklyTarget,
  );
}
