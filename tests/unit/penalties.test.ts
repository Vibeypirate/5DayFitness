import { describe, expect, it } from 'vitest';

import {
  calculateNetBalance,
  calculatePenaltyDistribution,
  summarizeLedgerRows,
  type BalanceLedgerRow,
} from '../../src/domain/penalties.js';

describe('penalty distribution', () => {
  it('splits failed-member penalties across winners', () => {
    const result = calculatePenaltyDistribution(
      [
        { participantId: 'a', displayName: 'A', completedDays: 5 },
        { participantId: 'b', displayName: 'B', completedDays: 5 },
        { participantId: 'c', displayName: 'C', completedDays: 3 },
      ],
      5,
      1000,
    );

    expect(result.failures).toEqual([{ participantId: 'c', displayName: 'C', amountOwed: 1000 }]);
    expect(result.earners).toEqual([
      { participantId: 'a', displayName: 'A', amountEarned: 500 },
      { participantId: 'b', displayName: 'B', amountEarned: 500 },
    ]);
    expect(result.unresolvedPenaltyPool).toBe(0);
  });

  it('marks the pool unresolved when nobody wins', () => {
    const result = calculatePenaltyDistribution(
      [{ participantId: 'a', displayName: 'A', completedDays: 2 }],
      5,
      1000,
    );

    expect(result.earners).toEqual([]);
    expect(result.unresolvedPenaltyPool).toBe(1000);
  });

  it('distributes extra pool amounts such as leave penalties across winners', () => {
    const result = calculatePenaltyDistribution(
      [
        { participantId: 'a', displayName: 'A', completedDays: 5 },
        { participantId: 'b', displayName: 'B', completedDays: 5 },
        { participantId: 'c', displayName: 'C', completedDays: 3 },
      ],
      5,
      1000,
      1000,
    );

    expect(result.failures).toEqual([{ participantId: 'c', displayName: 'C', amountOwed: 1000 }]);
    expect(result.earners).toEqual([
      { participantId: 'a', displayName: 'A', amountEarned: 1000 },
      { participantId: 'b', displayName: 'B', amountEarned: 1000 },
    ]);
  });

  it('uses explicit met-target flags when participants have different weekly targets', () => {
    const result = calculatePenaltyDistribution(
      [
        { participantId: 'a', displayName: 'A', completedDays: 2, metTarget: true },
        { participantId: 'b', displayName: 'B', completedDays: 4, metTarget: false },
      ],
      5,
      1000,
    );

    expect(result.failures).toEqual([{ participantId: 'b', displayName: 'B', amountOwed: 1000 }]);
    expect(result.earners).toEqual([{ participantId: 'a', displayName: 'A', amountEarned: 1000 }]);
  });

  it('treats owed amounts as negative and earned amounts as positive', () => {
    const rows: BalanceLedgerRow[] = [
      { type: 'OWED', amount: 1000 },
      { type: 'LEAVE_PENALTY', amount: 1000 },
      { type: 'EARNED', amount: 1500 },
      { type: 'MANUAL_ADJUSTMENT', amount: -250 },
    ];

    expect(summarizeLedgerRows(rows)).toEqual({
      totalOwed: 2000,
      totalEarned: 1500,
      netBalance: -750,
    });
    expect(calculateNetBalance(rows)).toBe(-750);
  });

  it('includes leave penalties in total owed and net balance', () => {
    expect(
      summarizeLedgerRows([
        { type: 'LEAVE_PENALTY', amount: 1000 },
        { type: 'EARNED', amount: 333 },
      ]),
    ).toEqual({
      totalOwed: 1000,
      totalEarned: 333,
      netBalance: -667,
    });
  });
});
