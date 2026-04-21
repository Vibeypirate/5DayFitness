import {
  ParticipantStatus,
  SessionStatus,
  WorkoutPhotoReviewPhase,
  WorkoutPhotoReviewStatus,
} from '@prisma/client';

import { prisma } from '../db.js';
import { startOfWeekLocal } from '../domain/time.js';
import { getParticipant } from './persistence.js';
import { WorkoutService } from './workout-service.js';

const workoutService = new WorkoutService();
const THUMBS_UP = '👍';
const THUMBS_DOWN = '👎';

export class WorkoutPhotoReviewService {
  async beginChallengePrompt(
    groupId: string,
    challengerUserId: string,
    targetUserId: string,
  ): Promise<string> {
    const challenger = await getParticipant(groupId, challengerUserId);
    if (!challenger || challenger.status !== ParticipantStatus.ACTIVE) {
      throw new Error('Only active challenge members can open a photo challenge.');
    }

    const targetParticipant = await getParticipant(groupId, targetUserId);
    if (!targetParticipant || targetParticipant.status !== ParticipantStatus.ACTIVE) {
      throw new Error('Target user must currently be in the challenge.');
    }

    if (challengerUserId === targetUserId) {
      throw new Error('You cannot challenge your own workout photo.');
    }

    await prisma.pendingPhotoChallenge.updateMany({
      where: {
        groupId,
        challengerUserId,
        status: 'WAITING_FOR_REASON',
      },
      data: {
        status: 'EXPIRED',
      },
    });

    await prisma.pendingPhotoChallenge.create({
      data: {
        groupId,
        challengerUserId,
        targetUserId,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    return 'State your reason.';
  }

  async tryCompleteChallengePrompt(
    groupId: string,
    challengerUserId: string,
    reason: string,
  ): Promise<{ reviewId: string; message: string } | null> {
    const pending = await prisma.pendingPhotoChallenge.findFirst({
      where: {
        groupId,
        challengerUserId,
        status: 'WAITING_FOR_REASON',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!pending) {
      return null;
    }

    if (pending.expiresAt < new Date()) {
      await prisma.pendingPhotoChallenge.update({
        where: { id: pending.id },
        data: { status: 'EXPIRED' },
      });
      throw new Error('No pending photo challenge. Run /challengephoto @username again.');
    }

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { settings: true },
    });
    if (!group?.settings) {
      throw new Error('Run /setup first.');
    }

    const session = await this.findLatestReviewableSession(
      groupId,
      pending.targetUserId,
      group.settings.timezone,
    );
    if (!session) {
      throw new Error('Could not find a recent workout photo for that user.');
    }

    const eligibleParticipants = await prisma.groupParticipant.findMany({
      where: {
        groupId,
        status: ParticipantStatus.ACTIVE,
        userId: {
          not: pending.targetUserId,
        },
      },
      include: {
        user: true,
      },
      orderBy: {
        user: {
          displayName: 'asc',
        },
      },
    });

    if (eligibleParticipants.length === 0) {
      throw new Error('There are no eligible voters for this challenge.');
    }

    const review = await prisma.$transaction(async (tx) => {
      const createdReview = await tx.workoutPhotoReview.create({
        data: {
          groupId,
          workoutSessionId: session.id,
          targetUserId: session.userId,
          openedByUserId: challengerUserId,
          phase: session.checkOutPhotoFileId
            ? WorkoutPhotoReviewPhase.CHECK_OUT
            : WorkoutPhotoReviewPhase.CHECK_IN,
          creditDateLocal: session.creditDateLocal,
          reason,
          requiredVoterCount: eligibleParticipants.length,
          reviewDeadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          votes: {
            create: eligibleParticipants.map((participant) => ({
              voterUserId: participant.userId,
            })),
          },
        },
      });

      await tx.pendingPhotoChallenge.update({
        where: { id: pending.id },
        data: { status: 'COMPLETED' },
      });

      return createdReview;
    });

    const mentions = eligibleParticipants
      .map((participant) => participant.user.username ?? participant.user.displayName)
      .map((value) => (value.startsWith('@') ? value : `@${value}`))
      .join(' ');

    return {
      reviewId: review.id,
      message: [
        `*Photo challenge opened*`,
        `${mentions}`.trim(),
        `${session.user.displayName}'s latest workout photo is under review.`,
        `Reason: ${reason}`,
        `Vote with ${THUMBS_UP} to cancel the workout or ${THUMBS_DOWN} to keep it.`,
        'The challenged user cannot vote.',
        'Voting closes in 24 hours.',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  async attachReviewMessageId(reviewId: string, reviewMessageId: number): Promise<void> {
    await prisma.workoutPhotoReview.update({
      where: { id: reviewId },
      data: { reviewMessageId },
    });
  }

  async recordReactionVote(input: {
    groupId: string;
    reviewMessageId: number;
    voterUserId: string;
    emoji: string;
  }): Promise<string | null> {
    const review = await prisma.workoutPhotoReview.findFirst({
      where: {
        groupId: input.groupId,
        OR: [
          { reviewMessageId: input.reviewMessageId },
          { tieBreakMessageId: input.reviewMessageId },
        ],
      },
      include: {
        targetUser: true,
        group: {
          include: { settings: true },
        },
        votes: {
          include: {
            voter: true,
          },
          orderBy: {
            voter: {
              displayName: 'asc',
            },
          },
        },
      },
    });

    if (!review) {
      return null;
    }

    if (input.emoji !== THUMBS_UP && input.emoji !== THUMBS_DOWN) {
      return null;
    }

    if (review.status === WorkoutPhotoReviewStatus.TIE_BREAK_PENDING) {
      if (review.group.settings?.ownerUserId !== input.voterUserId) {
        return null;
      }

      const passed = input.emoji === THUMBS_UP;
      if (passed) {
        await this.invalidateSessionFromReview(review.id);
      } else {
        await prisma.workoutPhotoReview.update({
          where: { id: review.id },
          data: {
            status: WorkoutPhotoReviewStatus.FAILED,
            resolvedAt: new Date(),
          },
        });
      }

      return passed
        ? `Creator tie-break: ${review.targetUser.displayName}'s workout was cancelled.`
        : `Creator tie-break: ${review.targetUser.displayName}'s workout stays valid.`;
    }

    if (review.status !== WorkoutPhotoReviewStatus.OPEN) {
      return null;
    }

    if (review.targetUserId === input.voterUserId) {
      return 'The challenged user cannot vote on this review.';
    }

    const voterRecord = review.votes.find((entry) => entry.voterUserId === input.voterUserId);
    if (!voterRecord) {
      return null;
    }

    await prisma.workoutPhotoReviewVote.update({
      where: { id: voterRecord.id },
      data: {
        vote: input.emoji === THUMBS_UP,
        votedAt: new Date(),
      },
    });

    const refreshedReview = await prisma.workoutPhotoReview.findUnique({
      where: { id: review.id },
      include: {
        targetUser: true,
        votes: {
          include: {
            voter: true,
          },
          orderBy: {
            voter: {
              displayName: 'asc',
            },
          },
        },
      },
    });

    if (!refreshedReview) {
      return null;
    }

    const yesVotes = refreshedReview.votes.filter((entry) => entry.vote === true).length;
    const noVotes = refreshedReview.votes.filter((entry) => entry.vote === false).length;
    const pendingVotes = refreshedReview.votes.filter((entry) => entry.vote === null);

    if (pendingVotes.length === 0) {
      return `Vote recorded. Final votes so far: ${yesVotes} yes, ${noVotes} no.`;
    }

    return [
      `Vote recorded for ${refreshedReview.targetUser.displayName}'s photo challenge.`,
      `Current votes: ${yesVotes} yes, ${noVotes} no, ${pendingVotes.length} pending.`,
      `Waiting on: ${pendingVotes.map((entry) => entry.voter.displayName).join(', ')}`,
    ].join('\n');
  }

  async sendHourlyReminders(now: Date): Promise<Array<{ groupId: string; message: string }>> {
    const openReviews = await prisma.workoutPhotoReview.findMany({
      where: {
        status: WorkoutPhotoReviewStatus.OPEN,
        reviewDeadlineAt: {
          gt: now,
        },
      },
      include: {
        votes: {
          include: {
            voter: true,
          },
        },
      },
    });

    const reminders: Array<{ groupId: string; message: string }> = [];

    for (const review of openReviews) {
      const lastSent = review.reminderLastSentAt?.getTime() ?? 0;
      if (now.getTime() - lastSent < 60 * 60 * 1000) {
        continue;
      }

      const pendingVotes = review.votes.filter((entry) => entry.vote === null);
      if (pendingVotes.length === 0) {
        continue;
      }

      reminders.push({
        groupId: review.groupId,
        message: [
          `Vote reminder for photo challenge #${review.id.slice(-6)}`,
          `Still waiting on: ${pendingVotes.map((entry) => entry.voter.username ?? entry.voter.displayName).join(', ')}`,
          `React with ${THUMBS_UP} or ${THUMBS_DOWN} before the 24-hour deadline.`,
        ].join('\n'),
      });

      await prisma.workoutPhotoReview.update({
        where: { id: review.id },
        data: { reminderLastSentAt: now },
      });
    }

    return reminders;
  }

  async resolveExpiredReviews(now: Date): Promise<Array<{ groupId: string; message: string }>> {
    const reviews = await prisma.workoutPhotoReview.findMany({
      where: {
        status: WorkoutPhotoReviewStatus.OPEN,
        reviewDeadlineAt: {
          lte: now,
        },
      },
      include: {
        group: {
          include: { settings: true },
        },
        targetUser: true,
        votes: true,
      },
    });

    const results: Array<{ groupId: string; message: string }> = [];

    for (const review of reviews) {
      const yesVotes = review.votes.filter((entry) => entry.vote === true).length;
      const noVotes = review.votes.filter((entry) => entry.vote === false).length;

      if (yesVotes > noVotes) {
        await this.invalidateSessionFromReview(review.id);
        results.push({
          groupId: review.groupId,
          message: `Photo challenge passed for ${review.targetUser.displayName}. Final votes: ${yesVotes} yes, ${noVotes} no.`,
        });
        continue;
      }

      if (noVotes > yesVotes) {
        await prisma.workoutPhotoReview.update({
          where: { id: review.id },
          data: {
            status: WorkoutPhotoReviewStatus.FAILED,
            resolvedAt: now,
          },
        });
        results.push({
          groupId: review.groupId,
          message: `Photo challenge failed for ${review.targetUser.displayName}. Final votes: ${yesVotes} yes, ${noVotes} no.`,
        });
        continue;
      }

      await prisma.workoutPhotoReview.update({
        where: { id: review.id },
        data: {
          status: WorkoutPhotoReviewStatus.TIE_BREAK_PENDING,
          tieBreakRequestedAt: now,
        },
      });

      results.push({
        groupId: review.groupId,
        message: `Tie detected for ${review.targetUser.displayName}. Waiting for the group creator to decide with ${THUMBS_UP} or ${THUMBS_DOWN}.`,
      });
    }

    return results;
  }

  private async findLatestReviewableSession(
    groupId: string,
    targetUserId: string,
    timezone: string,
  ) {
    const currentWeekStart = startOfWeekLocal(new Date(), timezone);

    return prisma.workoutSession.findFirst({
      where: {
        groupId,
        userId: targetUserId,
        status: {
          in: [SessionStatus.OPEN, SessionStatus.COMPLETED],
        },
        creditDateLocal: {
          gte: currentWeekStart,
        },
        OR: [
          { checkOutPhotoFileId: { not: null } },
          { checkInPhotoFileId: { not: null } },
        ],
      },
      include: {
        user: true,
      },
      orderBy: [
        { checkOutAtUtc: 'desc' },
        { checkInAtUtc: 'desc' },
      ],
    });
  }

  private async invalidateSessionFromReview(reviewId: string): Promise<void> {
    const review = await prisma.workoutPhotoReview.findUnique({
      where: { id: reviewId },
      include: {
        workoutSession: true,
      },
    });

    if (!review) {
      throw new Error('Photo review not found.');
    }

    await prisma.$transaction(async (tx) => {
      await tx.workoutPhotoReview.update({
        where: { id: review.id },
        data: {
          status: WorkoutPhotoReviewStatus.PASSED,
          resolvedAt: new Date(),
        },
      });

      await tx.workoutSession.update({
        where: { id: review.workoutSessionId },
        data: {
          status: SessionStatus.INVALIDATED,
          checkInPhotoFileId:
            review.phase === WorkoutPhotoReviewPhase.CHECK_IN ? null : review.workoutSession.checkInPhotoFileId,
          checkOutPhotoFileId:
            review.phase === WorkoutPhotoReviewPhase.CHECK_OUT ? null : review.workoutSession.checkOutPhotoFileId,
          invalidReason: `Invalidated by group photo review (${review.phase})`,
        },
      });

      await tx.workoutDayCredit.deleteMany({
        where: {
          workoutSessionId: review.workoutSessionId,
        },
      });
    });

    await workoutService.recomputeParticipantStats(review.workoutSession.participantId);
  }
}
