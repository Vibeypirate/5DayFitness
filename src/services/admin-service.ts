import { AdminActionType, ParticipantStatus, PenaltyLedgerType } from '@prisma/client';

import { prisma } from '../db.js';
import { summarizeLedgerRows } from '../domain/penalties.js';
import { startOfWeekLocal } from '../domain/time.js';
import { logAdminAction } from './persistence.js';

export class AdminService {
  async startChallenge(groupId: string, actorUserId: string): Promise<string> {
    await prisma.groupSettings.update({
      where: { groupId },
      data: {
        automationEnabled: true,
        challengeStartedAt: new Date(),
      },
    });

    await logAdminAction({
      groupId,
      actorUserId,
      actionType: AdminActionType.START_CHALLENGE,
      payloadJson: {},
    });

    return 'Challenge started. Workout photos, reminders, and weekly summaries are now live.';
  }

  async resetChallenge(groupId: string, actorUserId: string): Promise<string> {
    await prisma.$transaction(async (tx) => {
      await tx.scheduledJobLog.deleteMany({ where: { groupId } });
      await tx.penaltyLedger.deleteMany({ where: { groupId } });
      await tx.weeklySnapshot.deleteMany({ where: { groupId } });
      await tx.workoutDayCredit.deleteMany({ where: { groupId } });
      await tx.workoutSession.deleteMany({ where: { groupId } });
      await tx.groupParticipant.deleteMany({ where: { groupId } });
      await tx.adminActionLog.deleteMany({ where: { groupId } });
      await tx.groupSettings.update({
        where: { groupId },
        data: {
          automationEnabled: false,
          challengeStartedAt: null,
        },
      });
    });

    await logAdminAction({
      groupId,
      actorUserId,
      actionType: AdminActionType.RESET_CHALLENGE,
      payloadJson: {},
    });

    return 'Challenge data reset. Automation is off until /startchallenge is run again.';
  }

  async addParticipant(groupId: string, actorUserId: string, targetUserId: string): Promise<string> {
    const participant = await prisma.groupParticipant.upsert({
      where: {
        groupId_userId: {
          groupId,
          userId: targetUserId,
        },
      },
      update: {
        status: ParticipantStatus.ACTIVE,
        leftAt: null,
        pausedAt: null,
      },
      create: {
        groupId,
        userId: targetUserId,
        status: ParticipantStatus.ACTIVE,
      },
    });

    await logAdminAction({
      groupId,
      actorUserId,
      actionType: AdminActionType.ADD_PARTICIPANT,
      payloadJson: { participantId: participant.id, targetUserId },
    });

    return 'Participant added.';
  }

  async removeParticipant(groupId: string, actorUserId: string, targetUserId: string): Promise<string> {
    const participant = await prisma.groupParticipant.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: targetUserId,
        },
      },
    });
    if (!participant) {
      throw new Error('Participant not found.');
    }

    await prisma.groupParticipant.update({
      where: { id: participant.id },
      data: {
        status: ParticipantStatus.REMOVED,
        leftAt: new Date(),
      },
    });

    await logAdminAction({
      groupId,
      actorUserId,
      actionType: AdminActionType.REMOVE_PARTICIPANT,
      payloadJson: { participantId: participant.id, targetUserId },
    });

    return 'Participant removed.';
  }

  async overrideComplete(
    groupId: string,
    actorUserId: string,
    targetUserId: string,
    creditDateLocal: string,
    timezone: string,
  ): Promise<string> {
    const participant = await prisma.groupParticipant.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: targetUserId,
        },
      },
    });
    if (!participant) {
      throw new Error('Participant not found.');
    }

    const existing = await prisma.workoutDayCredit.findUnique({
      where: {
        groupId_userId_creditDateLocal: {
          groupId,
          userId: targetUserId,
          creditDateLocal,
        },
      },
    });
    if (existing) {
      throw new Error('That date is already credited.');
    }

    await prisma.$transaction(async (tx) => {
      await tx.workoutDayCredit.create({
        data: {
          groupId,
          userId: targetUserId,
          participantId: participant.id,
          creditDateLocal,
          weekStartDateLocal: startOfWeekLocal(new Date(`${creditDateLocal}T12:00:00.000Z`), timezone),
          timezone,
          source: 'ADMIN_OVERRIDE',
        },
      });

      await tx.groupParticipant.update({
        where: { id: participant.id },
        data: {
          lifetimeCompletedDays: { increment: 1 },
          lastCompletedWorkoutDate: creditDateLocal,
        },
      });
    });

    await logAdminAction({
      groupId,
      actorUserId,
      actionType: AdminActionType.OVERRIDE_COMPLETE,
      payloadJson: { targetUserId, creditDateLocal },
    });

    return 'Workout day override applied.';
  }

  async overridePenalty(
    groupId: string,
    actorUserId: string,
    targetUserId: string,
    amount: number,
    description: string,
  ): Promise<string> {
    await prisma.penaltyLedger.create({
      data: {
        groupId,
        userId: targetUserId,
        type: PenaltyLedgerType.MANUAL_ADJUSTMENT,
        amount,
        description,
      },
    });

    await logAdminAction({
      groupId,
      actorUserId,
      actionType: AdminActionType.OVERRIDE_PENALTY,
      payloadJson: { targetUserId, amount, description },
    });

    return 'Penalty adjustment saved.';
  }

  async clearDebt(groupId: string, actorUserId: string, targetUserId: string): Promise<string> {
    const ledgerRows = await prisma.penaltyLedger.findMany({
      where: { groupId, userId: targetUserId },
      select: { type: true, amount: true },
    });

    const balance = summarizeLedgerRows(ledgerRows);
    const netBalance = balance.netBalance;

    if (netBalance >= 0) {
      return 'This user does not owe any money.';
    }

    const adjustmentAmount = Math.abs(netBalance);

    await prisma.$transaction(async (tx) => {
      await tx.penaltyLedger.create({
        data: {
          groupId,
          userId: targetUserId,
          type: PenaltyLedgerType.MANUAL_ADJUSTMENT,
          amount: adjustmentAmount,
          description: `Debt cleared by admin — ${adjustmentAmount} baht paid`,
        },
      });

      const participant = await tx.groupParticipant.findUnique({
        where: { groupId_userId: { groupId, userId: targetUserId } },
      });

      if (participant) {
        await tx.groupParticipant.update({
          where: { id: participant.id },
          data: {
            totalPenaltiesOwed: Math.max(0, participant.totalPenaltiesOwed - adjustmentAmount),
          },
        });
      }
    });

    await logAdminAction({
      groupId,
      actorUserId,
      actionType: AdminActionType.OVERRIDE_PENALTY,
      payloadJson: { targetUserId, amount: adjustmentAmount, description: 'Debt cleared' },
    });

    const user = await prisma.user.findUnique({ where: { id: targetUserId } });
    const name = user?.username ? `@${user.username}` : user?.displayName ?? 'User';

    return `Debt cleared for ${name}. ${adjustmentAmount} baht paid. Net balance is now 0 baht.`;
  }

  async resetBalances(groupId: string, actorUserId: string): Promise<string> {
    await prisma.$transaction(async (tx) => {
      await tx.penaltyLedger.deleteMany({ where: { groupId } });
      await tx.weeklySnapshot.deleteMany({ where: { groupId } });
      await tx.weeklyParticipantResult.deleteMany({ where: { groupId } });
      await tx.groupParticipant.updateMany({
        where: { groupId },
        data: {
          totalPenaltiesOwed: 0,
          totalPenaltiesEarned: 0,
          totalSuccessfulWeeks: 0,
          totalFailedWeeks: 0,
          currentSuccessfulWeekStreak: 0,
          longestSuccessfulWeekStreak: 0,
        },
      });
    });

    await logAdminAction({
      groupId,
      actorUserId,
      actionType: AdminActionType.RESET_BALANCES,
      payloadJson: {},
    });

    return 'All penalty balances and weekly history have been reset. Everyone starts fresh from this week.';
  }

  async recordLeaveFromGroup(groupId: string, targetUserId: string, leftAt: Date): Promise<void> {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { settings: true },
    });
    if (!group?.settings) {
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.groupParticipant.update({
        where: {
          groupId_userId: {
            groupId,
            userId: targetUserId,
          },
        },
        data: {
          status: ParticipantStatus.LEFT_GROUP,
          leftAt,
          pausedAt: null,
          resumedAt: null,
        },
      });

      await tx.penaltyLedger.create({
        data: {
          groupId,
          userId: targetUserId,
          type: PenaltyLedgerType.LEAVE_PENALTY,
          amount: group.settings!.weeklyPenaltyAmount,
          description: 'Leave penalty',
        },
      });

      await tx.adminActionLog.create({
        data: {
          groupId,
          actorUserId: targetUserId,
          actionType: AdminActionType.REMOVE_PARTICIPANT,
          payloadJson: { targetUserId, leftAt: leftAt.toISOString(), source: 'left_group' },
        },
      });
    });
  }
}
