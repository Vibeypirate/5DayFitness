export type PenaltyDistributionInput = {
  participantId: string;
  displayName: string;
  completedDays: number;
  metTarget?: boolean;
};

export type BalanceLedgerRow = {
  type: 'OWED' | 'EARNED' | 'UNRESOLVED' | 'MANUAL_ADJUSTMENT' | 'LEAVE_PENALTY';
  amount: number;
};

export type PenaltyDistributionResult = {
  failures: Array<{ participantId: string; displayName: string; amountOwed: number }>;
  earners: Array<{ participantId: string; displayName: string; amountEarned: number }>;
  unresolvedPenaltyPool: number;
};

export function summarizeLedgerRows(rows: BalanceLedgerRow[]) {
  const totalOwed = rows
    .filter((row) => row.type === 'OWED' || row.type === 'LEAVE_PENALTY' || row.type === 'UNRESOLVED')
    .reduce((sum, row) => sum + row.amount, 0);

  const totalEarned = rows
    .filter((row) => row.type === 'EARNED')
    .reduce((sum, row) => sum + row.amount, 0);

  const manualDelta = rows
    .filter((row) => row.type === 'MANUAL_ADJUSTMENT')
    .reduce((sum, row) => sum + row.amount, 0);

  return {
    totalOwed,
    totalEarned,
    netBalance: totalEarned - totalOwed + manualDelta,
  };
}

export function calculateNetBalance(rows: BalanceLedgerRow[]): number {
  return summarizeLedgerRows(rows).netBalance;
}

export function calculatePenaltyDistribution(
  rows: PenaltyDistributionInput[],
  weeklyTarget: number,
  penaltyAmount: number,
  extraPoolAmount = 0,
): PenaltyDistributionResult {
  const failures = rows.filter((row) =>
    row.metTarget !== undefined ? !row.metTarget : row.completedDays < weeklyTarget,
  );
  const successes = rows.filter((row) =>
    row.metTarget !== undefined ? row.metTarget : row.completedDays >= weeklyTarget,
  );
  const totalPoolAmount = failures.length * penaltyAmount + extraPoolAmount;

  if (successes.length === 0) {
    return {
      failures: failures.map((row) => ({
        participantId: row.participantId,
        displayName: row.displayName,
        amountOwed: penaltyAmount,
      })),
      earners: [],
      unresolvedPenaltyPool: totalPoolAmount,
    };
  }

  const payoutPerWinner = Math.floor(totalPoolAmount / successes.length);
  return {
    failures: failures.map((row) => ({
      participantId: row.participantId,
      displayName: row.displayName,
      amountOwed: penaltyAmount,
    })),
    earners: successes.map((row) => ({
      participantId: row.participantId,
      displayName: row.displayName,
      amountEarned: payoutPerWinner,
    })),
    unresolvedPenaltyPool: 0,
  };
}
