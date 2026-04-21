export type LeaderboardEntry = {
  participantId: string;
  displayName: string;
  completedDays: number;
  successfulWeekStreak: number;
  lifetimeCompletedDays: number;
};

export function rankLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((left, right) => {
    if (right.completedDays !== left.completedDays) {
      return right.completedDays - left.completedDays;
    }

    if (right.successfulWeekStreak !== left.successfulWeekStreak) {
      return right.successfulWeekStreak - left.successfulWeekStreak;
    }

    if (right.lifetimeCompletedDays !== left.lifetimeCompletedDays) {
      return right.lifetimeCompletedDays - left.lifetimeCompletedDays;
    }

    return left.displayName.localeCompare(right.displayName);
  });
}

export type RankingLineInput = {
  rankLabel: string;
  displayName: string;
  completedDays?: number;
  weeklyTarget?: number;
  currentWorkoutDayStreak: number;
  lifetimeCompletedDays: number;
  totalMinutes: number;
};

export function formatRankingLine(input: RankingLineInput): string {
  const daysText =
    input.completedDays !== undefined && input.weeklyTarget !== undefined
      ? `${input.completedDays}/${input.weeklyTarget} days`
      : `total ${input.lifetimeCompletedDays} days`;

  return [
    `${input.rankLabel} ${input.displayName} ${daysText}`,
    `streak ${input.currentWorkoutDayStreak}`,
    `total ${input.lifetimeCompletedDays} days`,
    formatHours(input.totalMinutes),
  ].join(' | ');
}

export function formatWeekProgressLine(completedDays: number, weeklyTarget: number): string {
  return `This week: ${completedDays}/${weeklyTarget}`;
}

export function formatNetBalanceLine(netBalance: number): string {
  return `Net balance: ${netBalance} baht`;
}

function formatHours(totalMinutes: number): string {
  return `${(totalMinutes / 60).toFixed(1)}h`;
}
