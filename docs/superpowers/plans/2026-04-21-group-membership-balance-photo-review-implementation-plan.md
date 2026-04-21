# Group Membership, Balance, and Photo Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the bot from opt-in challenge membership to group-based membership, add prorated first-week targets and running balances, replace reply-based photo reviews with a reason-prompt plus reaction voting flow, and verify the weekly summary logic before one final redeploy.

**Architecture:** Keep the existing Prisma schema, service layer, domain helpers, and minute-based scheduler. Add targeted schema fields and focused helpers for effective weekly targets, balance aggregation, pending challenge prompts, and reaction-based review resolution instead of rewriting the app. Wire Telegram membership events and reaction updates into the same persistence-backed services so summaries, reminders, balances, and invalidations all use one source of truth.

**Tech Stack:** TypeScript, Prisma, grammY, node-cron, Luxon, Express, Vitest.

---

### Task 1: Add Membership, Owner, Balance, and Review State to the Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202604210001_membership_balance_review_redesign/migration.sql`
- Test: `tests/unit/penalties.test.ts`

- [ ] **Step 1: Write the failing test**

Add a ledger-oriented test that needs a leave-penalty event and balance aggregation shape the current schema does not support yet.

```ts
import { describe, expect, it } from 'vitest';

import {
  calculateNetBalance,
  summarizeLedgerRows,
  type BalanceLedgerRow,
} from '../../src/domain/penalties.js';

describe('balance aggregation', () => {
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/penalties.test.ts`
Expected: FAIL because `calculateNetBalance`, `summarizeLedgerRows`, and `LEAVE_PENALTY` support do not exist yet.

- [ ] **Step 3: Update the Prisma schema**

Extend the schema for group-based ownership, left-group membership, leave penalties, pending challenge prompts, and reaction-review deadlines.

```prisma
enum ParticipantStatus {
  ACTIVE
  LEFT_GROUP
  REMOVED
}

enum PenaltyLedgerType {
  OWED
  EARNED
  UNRESOLVED
  MANUAL_ADJUSTMENT
  LEAVE_PENALTY
}

enum PendingChallengeStatus {
  WAITING_FOR_REASON
  EXPIRED
  COMPLETED
}

enum WorkoutPhotoReviewStatus {
  OPEN
  PASSED
  FAILED
  TIE_BREAK_PENDING
}
```

```prisma
model GroupSettings {
  ownerUserId         String?
  owner               User?    @relation("GroupOwner", fields: [ownerUserId], references: [id], onDelete: SetNull)
}

model GroupParticipant {
  joinedWeekStartDateLocal String?
}

model WorkoutPhotoReview {
  reviewDeadlineAt    DateTime?
  reminderLastSentAt  DateTime?
  tieBreakRequestedAt DateTime?
  tieBreakMessageId   Int? @unique
}

model WorkoutPhotoReviewVote {
  viaTieBreak Boolean @default(false)
}
```

```prisma
model PendingPhotoChallenge {
  id               String                 @id @default(cuid())
  groupId          String
  challengerUserId String
  targetUserId     String
  status           PendingChallengeStatus @default(WAITING_FOR_REASON)
  expiresAt        DateTime
  createdAt        DateTime               @default(now())
  updatedAt        DateTime               @updatedAt

  @@unique([groupId, challengerUserId, status])
  @@index([groupId, expiresAt])
}
```

- [ ] **Step 4: Add the SQL migration**

Create the matching SQL migration with enum changes, new columns, and the new `PendingPhotoChallenge` table.

```sql
ALTER TYPE "ParticipantStatus" ADD VALUE IF NOT EXISTS 'LEFT_GROUP';
ALTER TYPE "PenaltyLedgerType" ADD VALUE IF NOT EXISTS 'LEAVE_PENALTY';
ALTER TYPE "WorkoutPhotoReviewStatus" ADD VALUE IF NOT EXISTS 'TIE_BREAK_PENDING';

CREATE TYPE "PendingChallengeStatus" AS ENUM ('WAITING_FOR_REASON', 'EXPIRED', 'COMPLETED');

ALTER TABLE "GroupSettings" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "GroupParticipant" ADD COLUMN "joinedWeekStartDateLocal" TEXT;
ALTER TABLE "WorkoutPhotoReview"
  ADD COLUMN "reviewDeadlineAt" TIMESTAMP(3),
  ADD COLUMN "reminderLastSentAt" TIMESTAMP(3),
  ADD COLUMN "tieBreakRequestedAt" TIMESTAMP(3),
  ADD COLUMN "tieBreakMessageId" INTEGER;
ALTER TABLE "WorkoutPhotoReviewVote" ADD COLUMN "viaTieBreak" BOOLEAN NOT NULL DEFAULT FALSE;
```

```sql
CREATE TABLE "PendingPhotoChallenge" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "challengerUserId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "status" "PendingChallengeStatus" NOT NULL DEFAULT 'WAITING_FOR_REASON',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PendingPhotoChallenge_pkey" PRIMARY KEY ("id")
);
```

- [ ] **Step 5: Run Prisma generation and the targeted test**

Run: `npm run prisma:generate`
Expected: Prisma client generation succeeds.

Run: `npm run test -- tests/unit/penalties.test.ts`
Expected: FAIL still, but now only for missing domain implementation rather than Prisma type errors.

### Task 2: Add Effective Weekly Target and Running Balance Domain Helpers

**Files:**
- Modify: `src/domain/penalties.ts`
- Create: `src/domain/weekly-target.ts`
- Test: `tests/unit/penalties.test.ts`
- Create: `tests/unit/weekly-target.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests for join-midweek target calculation and ledger-derived balance aggregation.

```ts
import { describe, expect, it } from 'vitest';

import { getEffectiveWeeklyTarget } from '../../src/domain/weekly-target.js';

describe('effective weekly target', () => {
  it('uses reduced target for the participant join week only', () => {
    expect(
      getEffectiveWeeklyTarget({
        baseWeeklyTarget: 5,
        participantJoinedDateLocal: '2026-04-22',
        participantJoinedWeekStartDateLocal: '2026-04-20',
        weekStartDateLocal: '2026-04-20',
      }),
    ).toBe(2);

    expect(
      getEffectiveWeeklyTarget({
        baseWeeklyTarget: 5,
        participantJoinedDateLocal: '2026-04-22',
        participantJoinedWeekStartDateLocal: '2026-04-20',
        weekStartDateLocal: '2026-04-27',
      }),
    ).toBe(5);
  });
});
```

```ts
import { describe, expect, it } from 'vitest';

import { summarizeLedgerRows } from '../../src/domain/penalties.js';

describe('ledger summary', () => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/weekly-target.test.ts tests/unit/penalties.test.ts`
Expected: FAIL because the new helpers do not exist yet.

- [ ] **Step 3: Implement the weekly-target helper**

Create a small pure helper that maps join weekday to the approved reduced target for that join week.

```ts
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
```

- [ ] **Step 4: Extend the penalties domain**

Implement a typed balance helper without changing the existing weekly-distribution entry point yet.

```ts
export type BalanceLedgerRow = {
  type: 'OWED' | 'EARNED' | 'UNRESOLVED' | 'MANUAL_ADJUSTMENT' | 'LEAVE_PENALTY';
  amount: number;
};

export function summarizeLedgerRows(rows: BalanceLedgerRow[]) {
  const totalOwed = rows
    .filter((row) => row.type === 'OWED' || row.type === 'LEAVE_PENALTY')
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- tests/unit/weekly-target.test.ts tests/unit/penalties.test.ts`
Expected: PASS.

### Task 3: Move Participant Stats and Leaderboards to Effective Targets and Net Balances

**Files:**
- Modify: `src/services/participant-service.ts`
- Modify: `src/services/group-service.ts`
- Modify: `src/services/leaderboard-service.ts`
- Modify: `src/domain/leaderboard.ts`
- Test: `tests/unit/leaderboard.test.ts`

- [ ] **Step 1: Write the failing test**

Add a formatter test proving ranking lines can show per-person effective target and lifetime totals together.

```ts
import { describe, expect, it } from 'vitest';

import { formatRankingLine } from '../../src/domain/leaderboard.js';

describe('ranking line formatter', () => {
  it('shows completed days against effective target plus total days and hours', () => {
    expect(
      formatRankingLine({
        rankLabel: '1.',
        displayName: '@indy',
        completedDays: 2,
        weeklyTarget: 2,
        currentWorkoutDayStreak: 0,
        lifetimeCompletedDays: 18,
        totalMinutes: 480,
      }),
    ).toContain('2/2 days');
  });
});
```

- [ ] **Step 2: Run the targeted test to verify it passes first, then add the real failing assertion**

Run: `npm run test -- tests/unit/leaderboard.test.ts`
Expected: PASS before behavior changes.

Add assertions for balance and effective-target text in service outputs:

```ts
expect(statusText).toContain('This week: 2/2');
expect(statusText).toContain('Net balance: -667 baht');
```

Run: `npm run test -- tests/unit/leaderboard.test.ts`
Expected: FAIL because the services do not compute per-user effective targets or net balance yet.

- [ ] **Step 3: Implement service-level balance and target queries**

Update participant-facing stats to compute:
- current week count
- effective current-week target
- total owed
- total earned
- net balance

```ts
const ledgerRows = await prisma.penaltyLedger.findMany({
  where: { groupId, userId },
  select: { type: true, amount: true },
});

const weekCount = await prisma.workoutDayCredit.count({
  where: { groupId, userId, weekStartDateLocal: weekStart },
});

const effectiveTarget = getEffectiveWeeklyTarget({
  baseWeeklyTarget: group.settings.weeklyTarget,
  participantJoinedDateLocal: participant.joinedAt.toISOString().slice(0, 10),
  participantJoinedWeekStartDateLocal: participant.joinedWeekStartDateLocal,
  weekStartDateLocal: weekStart,
});
```

- [ ] **Step 4: Simplify `/help` and shorter rules-oriented copy**

Keep `/help` as the short command hub and remove challenge join/pause/resume commands from user-facing help text.

```ts
return [
  '*Commands*',
  '/help',
  '/setup',
  '/status',
  '/mystats',
  '/leaderboard',
  '/weeklysummary',
  '/groupstats',
  '/challengephoto @username',
  '/settarget 5',
  '/setpenalty 1000',
  '/settimezone Asia/Bangkok',
  '/setminduration 20',
  '/setremindertime 20:00',
].join('\\n');
```

- [ ] **Step 5: Run the targeted tests**

Run: `npm run test -- tests/unit/leaderboard.test.ts`
Expected: PASS.

### Task 4: Replace Manual Enrollment with Group Membership Sync

**Files:**
- Modify: `src/bot/create-bot.ts`
- Modify: `src/services/persistence.ts`
- Modify: `src/services/admin-service.ts`
- Modify: `src/services/group-service.ts`
- Test: `tests/integration/workflow.test.ts`

- [ ] **Step 1: Write the failing integration test**

Add a workflow test covering join auto-enrollment and leave persistence.

```ts
import { describe, expect, it } from 'vitest';

describe('group membership sync', () => {
  it('auto-enrolls new members and marks leavers as left_group', async () => {
    const participantAfterJoin = await markParticipantPresent(
      'group-1',
      'user-1',
      new Date('2026-04-22T03:00:00.000Z'),
      'Asia/Bangkok',
    );

    expect(participantAfterJoin.status).toBe('ACTIVE');
    expect(participantAfterJoin.joinedWeekStartDateLocal).toBe('2026-04-20');

    const participantAfterLeave = await markParticipantLeftGroup(
      'group-1',
      'user-1',
      new Date('2026-04-24T03:00:00.000Z'),
    );

    expect(participantAfterLeave.status).toBe('LEFT_GROUP');
    expect(participantAfterLeave.leftAt?.toISOString()).toBe('2026-04-24T03:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `npm run test -- tests/integration/workflow.test.ts`
Expected: FAIL once the assertions are updated because the bot still relies on manual enrollment and has no leave-handler path.

- [ ] **Step 3: Implement persistence helpers for group-based membership**

Add focused helpers in `src/services/persistence.ts`.

```ts
export async function markParticipantPresent(groupId: string, userId: string, joinedAt: Date, timezone: string) {
  return prisma.groupParticipant.upsert({
    where: { groupId_userId: { groupId, userId } },
    update: {
      status: ParticipantStatus.ACTIVE,
      leftAt: null,
      joinedAt,
      joinedWeekStartDateLocal: startOfWeekLocal(joinedAt, timezone),
    },
    create: {
      groupId,
      userId,
      status: ParticipantStatus.ACTIVE,
      joinedAt,
      joinedWeekStartDateLocal: startOfWeekLocal(joinedAt, timezone),
    },
  });
}
```

```ts
export async function markParticipantLeftGroup(groupId: string, userId: string, leftAt: Date) {
  return prisma.groupParticipant.update({
    where: { groupId_userId: { groupId, userId } },
    data: {
      status: ParticipantStatus.LEFT_GROUP,
      leftAt,
    },
  });
}
```

- [ ] **Step 4: Wire Telegram membership events**

Handle `message:new_chat_members` and `message:left_chat_member` by syncing membership and removing the public dependence on `/joinchallenge`.

```ts
bot.on('message:new_chat_members', async (ctx) => {
  const { group } = await ensureGroupAndActor(ctx);
  for (const member of ctx.message.new_chat_members) {
    if (member.is_bot) {
      continue;
    }
    const user = await resolveOrCreateTelegramUser(member);
    await markParticipantPresent(group.id, user.id, new Date(ctx.message.date * 1000), group.settings!.timezone);
  }
});
```

```ts
bot.on('message:left_chat_member', async (ctx) => {
  const group = await requireConfiguredGroup(ctx);
  const actor = ctx.message.left_chat_member;
  if (actor.is_bot) {
    return;
  }
  const user = await resolveOrCreateTelegramUser(actor);
  await adminService.recordLeaveFromGroup(group.id, user.id, new Date(ctx.message.date * 1000));
});
```

- [ ] **Step 5: Remove old challenge-enrollment commands from the bot flow**

Delete command handlers and welcome text for:
- `/joinchallenge`
- `/leavechallenge`
- `/pausechallenge`
- `/resumechallenge`

Replace `/setup` next steps with group-based copy:

```ts
return [
  `Group ready: ${group.telegramTitle}`,
  `Timezone: ${group.settings?.timezone ?? DEFAULT_TIMEZONE}`,
  `Target: ${group.settings?.weeklyTarget ?? DEFAULT_WEEKLY_TARGET}/week`,
  `Penalty: ${group.settings?.weeklyPenaltyAmount ?? DEFAULT_WEEKLY_PENALTY} baht`,
  '',
  'Next steps:',
  'All non-bot members in this group are automatically in the challenge.',
  '/startchallenge when you are ready to begin tracking',
  'First workout photo = check in',
  'Second workout photo after the minimum time = check out',
].join('\\n');
```

- [ ] **Step 6: Run the integration test**

Run: `npm run test -- tests/integration/workflow.test.ts`
Expected: PASS.

### Task 5: Record Leave Penalties and Use Effective Targets in Weekly Summaries

**Files:**
- Modify: `src/services/admin-service.ts`
- Modify: `src/services/weekly-rollup-service.ts`
- Modify: `src/domain/penalties.ts`
- Test: `tests/integration/workflow.test.ts`
- Test: `tests/unit/penalties.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that require:
- a leaver still counts for the current week
- a leave penalty is included in the weekly pool
- the current week uses effective per-user targets

```ts
expect(summary).toContain('@max leave penalty: 1000 baht');
expect(summary).toContain('Hit target: @indy');
expect(summary).toContain('Missed target: @max');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/penalties.test.ts tests/integration/workflow.test.ts`
Expected: FAIL because weekly rollup still uses one shared target and has no leave-penalty path.

- [ ] **Step 3: Add a leave-penalty recording path**

Implement an admin-service helper called from the leave event handler.

```ts
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
      where: { groupId_userId: { groupId, userId: targetUserId } },
      data: {
        status: ParticipantStatus.LEFT_GROUP,
        leftAt,
      },
    });

    await tx.penaltyLedger.create({
      data: {
        groupId,
        userId: targetUserId,
        type: PenaltyLedgerType.LEAVE_PENALTY,
        amount: group.settings.weeklyPenaltyAmount,
        description: 'Leave penalty',
      },
    });
  });
}
```

- [ ] **Step 4: Update weekly-rollup logic**

Use effective targets per participant and include leave penalties incurred in the summarized week.

```ts
const effectiveTarget = getEffectiveWeeklyTarget({
  baseWeeklyTarget: group.settings!.weeklyTarget,
  participantJoinedDateLocal: participant.joinedAt.toISOString().slice(0, 10),
  participantJoinedWeekStartDateLocal: participant.joinedWeekStartDateLocal,
  weekStartDateLocal: previousWeekStart,
});

const metTarget = row.completedDays >= effectiveTarget;
```

```ts
const leavePenaltyRows = await prisma.penaltyLedger.findMany({
  where: {
    groupId,
    type: PenaltyLedgerType.LEAVE_PENALTY,
    createdAt: {
      gte: new Date(`${previousWeekStart}T00:00:00.000Z`),
      lte: now,
    },
  },
});
```

Use the total of these leave penalties as part of the distributed pool, and add explicit summary lines:

```ts
...leavePenaltyRows.map((row) => `${displayNameByUserId.get(row.userId!) ?? 'Unknown'} leave penalty: ${row.amount} baht`)
```

- [ ] **Step 5: Run the tests**

Run: `npm run test -- tests/unit/penalties.test.ts tests/integration/workflow.test.ts`
Expected: PASS.

### Task 6: Replace Reply-Based Photo Reviews with Prompted Reason Capture

**Files:**
- Modify: `src/services/workout-photo-review-service.ts`
- Modify: `src/bot/create-bot.ts`
- Test: `tests/integration/workflow.test.ts`

- [ ] **Step 1: Write the failing integration test**

Add a flow test for:
- `/challengephoto @username`
- bot prompt asking for reason
- follow-up text creating the review

```ts
expect(prompt).toBe('State your reason.');
expect(reviewMessage).toContain('Please vote with 👍 or 👎');
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `npm run test -- tests/integration/workflow.test.ts`
Expected: FAIL because the current command expects a reply target and immediate reason.

- [ ] **Step 3: Add pending challenge helpers**

Teach the review service to create and consume short-lived pending prompts.

```ts
async beginChallengePrompt(groupId: string, challengerUserId: string, targetUserId: string) {
  await prisma.pendingPhotoChallenge.updateMany({
    where: { groupId, challengerUserId, status: 'WAITING_FOR_REASON' },
    data: { status: 'EXPIRED' },
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
```

```ts
async completeChallengePrompt(groupId: string, challengerUserId: string, reason: string) {
  const pending = await prisma.pendingPhotoChallenge.findFirst({
    where: { groupId, challengerUserId, status: 'WAITING_FOR_REASON' },
    orderBy: { createdAt: 'desc' },
  });
  if (!pending || pending.expiresAt < new Date()) {
    throw new Error('No pending photo challenge. Run /challengephoto @username again.');
  }
}
```

- [ ] **Step 4: Change the bot command and text-message flow**

Keep `/challengephoto @username` as the command entry, then consume the challenger's next non-command message as the reason.

```ts
bot.command('challengephoto', async (ctx) => {
  const { group, user } = await ensureGroupAndActor(ctx);
  const target = await resolveUserFromArgument(ctx.match);
  await ctx.reply(await workoutPhotoReviewService.beginChallengePrompt(group.id, user.id, target.id));
});
```

```ts
bot.on('message:text', async (ctx) => {
  if (isCommandMessage) {
    return;
  }

  const { group, user } = await ensureGroupAndActor(ctx);
  const maybeReview = await workoutPhotoReviewService.tryCompleteChallengePrompt(
    group.id,
    user.id,
    ctx.message.text,
  );

  if (maybeReview) {
    const sent = await ctx.reply(maybeReview.message, { parse_mode: 'Markdown' });
    await workoutPhotoReviewService.attachReviewMessageId(maybeReview.reviewId, sent.message_id);
    return;
  }
});
```

- [ ] **Step 5: Run the integration test**

Run: `npm run test -- tests/integration/workflow.test.ts`
Expected: PASS.

### Task 7: Add Reaction-Based Voting, Hourly Vote Reminders, and Creator Tie-Breaks

**Files:**
- Modify: `src/services/workout-photo-review-service.ts`
- Modify: `src/scheduler.ts`
- Modify: `src/bot/create-bot.ts`
- Modify: `src/services/group-service.ts`
- Test: `tests/integration/workflow.test.ts`

- [ ] **Step 1: Write the failing integration test**

Add a review-resolution test with:
- reactions mapping to yes/no
- 24-hour timeout
- tie -> creator-only tie-break

```ts
expect(result).toContain('Final votes: 2 yes, 1 no.');
expect(tieMessage).toContain('Tie detected. Waiting for the group creator to decide.');
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `npm run test -- tests/integration/workflow.test.ts`
Expected: FAIL because the app currently only supports `/votephoto yes|no` replies.

- [ ] **Step 3: Replace command-based voting with reaction-based recording**

Add a service entry point for reaction updates. Use boolean mapping for 👍 and 👎 only.

```ts
async recordReactionVote(input: {
  groupId: string;
  reviewMessageId: number;
  voterUserId: string;
  emoji: string;
}) {
  const vote = input.emoji === '👍' ? true : input.emoji === '👎' ? false : null;
  if (vote === null) {
    return null;
  }

  const review = await prisma.workoutPhotoReview.findFirst({
    where: { groupId: input.groupId, reviewMessageId: input.reviewMessageId },
    include: { votes: true },
  });

  if (!review || review.targetUserId === input.voterUserId) {
    return null;
  }

  await prisma.workoutPhotoReviewVote.updateMany({
    where: {
      workoutPhotoReviewId: review.id,
      voterUserId: input.voterUserId,
    },
    data: {
      vote,
      votedAt: new Date(),
    },
  });
}
```

- [ ] **Step 4: Resolve open reviews in the scheduler**

Check for expired open reviews every minute, send hourly reminders, and branch into passed, failed, or tie-break states.

```ts
const openReviews = await prisma.workoutPhotoReview.findMany({
  where: { status: WorkoutPhotoReviewStatus.OPEN },
  include: { votes: { include: { voter: true } } },
});

for (const review of openReviews) {
  if (shouldSendReminder(review, now)) {
    await bot.api.sendMessage(
      Number(group.telegramChatId),
      buildPendingVoteReminder(review),
      { parse_mode: 'Markdown' },
    );
  }

  if (review.reviewDeadlineAt && review.reviewDeadlineAt <= now) {
    await workoutPhotoReviewService.resolveExpiredReview(review.id);
  }
}
```

- [ ] **Step 5: Add creator-only tie-break flow**

If yes and no are tied after 24 hours, move the review to `TIE_BREAK_PENDING` and ask the stored owner user.

```ts
if (yesVotes === noVotes) {
  await prisma.workoutPhotoReview.update({
    where: { id: review.id },
    data: {
      status: WorkoutPhotoReviewStatus.TIE_BREAK_PENDING,
      tieBreakRequestedAt: now,
    },
  });

  return {
    type: 'tie_break',
    message: 'Tie detected. Waiting for the group creator to decide with 👍 or 👎.',
  };
}
```

Only accept tie-break reactions from `group.settings.ownerUserId`.

- [ ] **Step 6: Remove the old `/votephoto` command**

Delete the `/votephoto` handler and any help/rules text that advertises it.

- [ ] **Step 7: Run the integration test**

Run: `npm run test -- tests/integration/workflow.test.ts`
Expected: PASS.

### Task 8: Detect and Store the Telegram Group Creator During Setup

**Files:**
- Modify: `src/services/group-service.ts`
- Modify: `src/bot/utils.ts`
- Modify: `src/bot/create-bot.ts`
- Test: `tests/integration/workflow.test.ts`

- [ ] **Step 1: Write the failing integration test**

Add a setup-path test that expects `ownerUserId` to be set from creator metadata.

```ts
expect(setupMessage).toContain('Owner detected');
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `npm run test -- tests/integration/workflow.test.ts`
Expected: FAIL because setup does not fetch or persist creator metadata yet.

- [ ] **Step 3: Implement creator detection**

Fetch administrators through the Telegram API during setup and store the creator.

```ts
async detectAndStoreOwner(groupId: string, telegramChatId: string, bot: Bot) {
  const admins = await bot.api.getChatAdministrators(Number(telegramChatId));
  const creator = admins.find((admin) => admin.status === 'creator');
  if (!creator || creator.user.is_bot) {
    throw new Error('Group creator could not be detected. Setup cannot continue.');
  }

  const owner = await upsertUser({
    telegramUserId: String(creator.user.id),
    username: creator.user.username ?? null,
    firstName: creator.user.first_name,
    lastName: creator.user.last_name ?? null,
  });

  await prisma.groupSettings.update({
    where: { groupId },
    data: { ownerUserId: owner.id },
  });
}
```

- [ ] **Step 4: Call creator detection from `/setup`**

After the group is ensured, detect the owner before replying success.

```ts
const { group } = await ensureGroupAndActor(ctx);
await groupService.detectAndStoreOwner(group.id, group.telegramChatId, bot);
await ctx.reply(await groupService.setupGroup(group.telegramChatId));
```

- [ ] **Step 5: Run the integration test**

Run: `npm run test -- tests/integration/workflow.test.ts`
Expected: PASS.

### Task 9: Verify Weekly Logic, Scheduler Flow, and Production-Safe Output

**Files:**
- Modify: `tests/unit/time.test.ts`
- Modify: `tests/integration/workflow.test.ts`
- Modify: `src/services/workout-service.ts`
- Modify: `src/services/weekly-rollup-service.ts`

- [ ] **Step 1: Write the failing tests**

Add assertions for:
- correct week selection at boundary time
- no fixed "30 minutes" text when the configured minimum differs
- weekly summary using correct target text and total workouts

```ts
expect(primary).toContain('Minimum workout time: 20 minutes.');
expect(summary).toContain('total 18 days');
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `npm run test -- tests/unit/time.test.ts tests/integration/workflow.test.ts`
Expected: FAIL because the workout check-in copy is still hard-coded and summary output is not fully aligned with the redesign.

- [ ] **Step 3: Fix the remaining user-facing copy and rollup output**

Use the configured minimum session time and the new balance-aware summary lines.

```ts
return {
  primary: [
    `${participant.user.displayName} checked in at ${this.formatLocalTime(input.sentAt, settings.timezone)}.`,
    'Enjoy your workout. Send your next photo when you are done.',
    `Minimum workout time: ${settings.minSessionMinutes} minutes.`,
    `Week progress: ${weekProgress}/${settings.weeklyTarget}`,
  ].join('\\n'),
};
```

Add summary lines like:

```ts
`Net balances:`,
...balanceRows.map((row) => `${row.displayName}: ${row.netBalance} baht`)
```

- [ ] **Step 4: Run the full verification suite**

Run: `npm run test`
Expected: all tests pass.

Run: `npm run build`
Expected: TypeScript compilation succeeds.

Run: `npm run lint`
Expected: lint passes.

- [ ] **Step 5: Manual pre-redeploy verification**

Run these checks in the deployed environment after shipping:

```bash
curl https://<app-domain>/health
```

Expected: `200 OK`

Verify in Telegram:
- `/setup` succeeds and detects the creator
- new member joins auto-create challenge membership
- leaving the group records a leave penalty
- `/challengephoto @username` prompts for a reason
- 👍/👎 reactions are recorded
- hourly reminders only tag missing voters
- weekly summary names leavers and shows correct winners, losers, and balances

### Task 10: Repo Initialization Follow-Up After This Session

**Files:**
- None in code.

- [ ] **Step 1: Initialize git after implementation is complete**

Run:

```bash
git init
git add .
git commit -m "chore: snapshot fitness tracker before redesign rollout"
```

Expected: a local repository exists for future incremental commits.

- [ ] **Step 2: Tag the pre-redeploy checkpoint**

Run:

```bash
git add prisma src tests docs
git commit -m "feat: redesign challenge membership, balances, and photo reviews"
```

Expected: one clean checkpoint exists before Railway redeploy.
