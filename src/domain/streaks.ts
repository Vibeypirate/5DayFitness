export function applyWorkoutDayStreak(
  currentStreak: number,
  longestStreak: number,
  lastCompletedDate: string | null,
  creditDate: string,
): { currentStreak: number; longestStreak: number } {
  const next = nextWorkoutDayStreak(currentStreak, lastCompletedDate, creditDate);

  return {
    currentStreak: next,
    longestStreak: Math.max(longestStreak, next),
  };
}

export function nextWorkoutDayStreak(
  currentStreak: number,
  lastCompletedDate: string | null,
  creditDate: string,
): number {
  if (!lastCompletedDate) {
    return 1;
  }

  const last = new Date(`${lastCompletedDate}T00:00:00.000Z`);
  const current = new Date(`${creditDate}T00:00:00.000Z`);
  const diffDays = Math.round((current.getTime() - last.getTime()) / 86400000);

  if (diffDays === 1) {
    return currentStreak + 1;
  }

  if (diffDays <= 0) {
    return currentStreak;
  }

  return 1;
}

export function nextSuccessfulWeekStreak(
  currentStreak: number,
  metTarget: boolean,
): number {
  return metTarget ? currentStreak + 1 : 0;
}
