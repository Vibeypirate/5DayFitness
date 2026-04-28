# Bot Edge Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix edge cases in workout tracking: 6-hour checkout with auto-abandon, midnight workout logging, penalty distribution verification, and simplified void-session voting.

**Architecture:** Update domain validation rules, add `ABANDONED` session status, auto-abandon stale sessions on new check-in, add `/voidsession` command with shorter voting window and immediate majority resolution, and fix midnight time boundary handling.

**Tech Stack:** Node.js, TypeScript, Prisma, PostgreSQL, Grammy (Telegram), Vitest, Luxon

---

### Task 1: Database Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: Migration file via `npx prisma migrate dev`

- [ ] **Step 1: Add `ABANDONED` to `SessionStatus` enum**

```prisma
enum SessionStatus {
  OPEN
  COMPLETED
  INVALIDATED
  ABANDONED
}
```

- [ ] **Step 2: Add abandoned fields to `WorkoutSession`**

```prisma
model WorkoutSession {
  // ... existing fields ...
  abandonedAtUtc  DateTime?
  abandonedReason String?
}
```

- [ ] **Step 3: Add `WorkoutPhotoReviewType` enum and field**

```prisma
enum WorkoutPhotoReviewType {
  CHALLENGE
  VOID_VOTE
}

model WorkoutPhotoReview {
  // ... existing fields ...
  reviewType WorkoutPhotoReviewType @default(CHALLENGE)
}
```

- [ ] **Step 4: Generate and run migration**

Run: `npx prisma migrate dev --name add_abandoned_session_and_void_vote`
Expected: Migration succeeds, `prisma/client` is regenerated.

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "feat: add ABANDONED session status and VOID_VOTE review type"
```

---

### Task 2: Update Domain Constants and Validation

**Files:**
- Modify: `src/domain/constants.ts`
- Modify: `src/domain/workout.ts`
- Test: `tests/unit/workout.test.ts`

- [ ] **Step 1: Add `DEFAULT_MAX_CHECKOUT_HOURS` constant**

In `src/domain/constants.ts`, add:
```typescript
export const DEFAULT_MAX_CHECKOUT_HOURS = 6;
```

- [ ] **Step 2: Update `validateCheckOut` to use 6-hour limit**

In `src/domain/workout.ts`, change the max age check from 24 to `DEFAULT_MAX_CHECKOUT_HOURS`:
```typescript
import { DEFAULT_MAX_CHECKOUT_HOURS } from './constants.js';

export function validateCheckOut(checkInAt: Date, checkOutAt: Date, minSessionMinutes: number): { valid: true } | { valid: false; reason: string } {
  const durationMinutes = minutesBetween(checkInAt, checkOutAt);
  if (durationMinutes < minSessionMinutes) {
    return { valid: false, reason: `Session too short. Minimum ${minSessionMinutes} minutes.` };
  }
  const ageHours = (checkOutAt.getTime() - checkInAt.getTime()) / 3600000;
  if (ageHours > DEFAULT_MAX_CHECKOUT_HOURS) {
    return { valid: false, reason: `Check-out must happen within ${DEFAULT_MAX_CHECKOUT_HOURS} hours of check-in.` };
  }
  return { valid: true };
}
```

- [ ] **Step 3: Add test for 6-hour rejection in `tests/unit/workout.test.ts`**

```typescript
import { DEFAULT_MAX_CHECKOUT_HOURS } from '../../src/domain/constants.js';

test('validateCheckOut rejects sessions older than 6 hours', () => {
  const checkIn = new Date('2024-01-01T10:00:00Z');
  const checkOut = new Date('2024-01-01T16:01:00Z'); // 6h 1m
  const result = validateCheckOut(checkIn, checkOut, 30);
  expect(result.valid).toBe(false);
  expect(result.reason).toContain('6 hours');
});

test('validateCheckOut accepts sessions within 6 hours', () => {
  const checkIn = new Date('2024-01-01T10:00:00Z');
  const checkOut = new Date('2024-01-01T15:59:00Z'); // 5h 59m
  const result = validateCheckOut(checkIn, checkOut, 30);
  expect(result.valid).toBe(true);
});
```

- [ ] **Step 4: Run unit tests**

Run: `npx vitest run tests/unit/workout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/constants.ts src/domain/workout.ts tests/unit/workout.test.ts
git commit -m "feat: enforce 6-hour checkout limit in domain validation"
```

---

### Task 3: Fix Midnight Workout Logging

**Files:**
- Modify: `src/domain/time.ts`
- Test: `tests/unit/time.test.ts`

- [ ] **Step 1: Audit `localDate` function for midnight correctness**

Read `src/domain/time.ts` and confirm `localDate` uses Luxon correctly:
```typescript
import { DateTime } from 'luxon';

export function localDate(utcDate: Date, timeZone: string): string {
  return DateTime.fromJSDate(utcDate, { zone: 'utc' })
    .setZone(timeZone)
    .toFormat('yyyy-MM-dd');
}
```
If it does not match the above pattern (e.g., uses manual offset math), replace it.

- [ ] **Step 2: Add midnight boundary tests**

In `tests/unit/time.test.ts`, add:
```typescript
import { localDate } from '../../src/domain/time.js';

test('localDate returns correct date for just after midnight', () => {
  // 2024-01-02T00:15:00 in Asia/Bangkok = 2024-01-01T17:15:00Z
  const utc = new Date('2024-01-01T17:15:00Z');
  expect(localDate(utc, 'Asia/Bangkok')).toBe('2024-01-02');
});

test('localDate returns correct date for just before midnight', () => {
  // 2024-01-01T23:59:00 in Asia/Bangkok = 2024-01-01T16:59:00Z
  const utc = new Date('2024-01-01T16:59:00Z');
  expect(localDate(utc, 'Asia/Bangkok')).toBe('2024-01-01');
});

test('localDate handles week boundary at midnight Sunday-Monday', () => {
  // Monday 00:15 in Asia/Bangkok
  const utc = new Date('2024-01-07T17:15:00Z'); // Sun 17:15 UTC = Mon 00:15 Bangkok
  expect(localDate(utc, 'Asia/Bangkok')).toBe('2024-01-08');
});
```

- [ ] **Step 3: Run time tests**

Run: `npx vitest run tests/unit/time.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/domain/time.ts tests/unit/time.test.ts
git commit -m "fix: ensure midnight workouts map to correct local date"
```

---

### Task 4: Auto-Abandon Stale Sessions in WorkoutService

**Files:**
- Modify: `src/services/workout-service.ts`
- Modify: `src/services/persistence.ts`
- Test: `tests/integration/workflow.test.ts` (add new test)

- [ ] **Step 1: Add `abandonSession` to persistence layer**

In `src/services/persistence.ts`, add:
```typescript
export async function abandonSession(sessionId: string, reason: string): Promise<void> {
  await prisma.workoutSession.update({
    where: { id: sessionId },
    data: {
      status: 'ABANDONED',
      abandonedAtUtc: new Date(),
      abandonedReason: reason,
    },
  });
}
```

- [ ] **Step 2: Update `handleWorkoutMessage` to auto-abandon sessions >6h old**

In `src/services/workout-service.ts`, in the flow where an `OPEN` session is found:
```typescript
const ageHours = (input.sentAt.getTime() - openSession.checkInAtUtc.getTime()) / 3600000;

if (ageHours > DEFAULT_MAX_CHECKOUT_HOURS) {
  // Auto-abandon stale session and start new check-in
  await persistence.abandonSession(openSession.id, 'EXPIRED');
  const newSession = await this.startSession(input, photoFileId);
  return {
    primary: `Your previous workout from ${formatTime(openSession.checkInAtUtc)} was abandoned because you didn't check out within ${DEFAULT_MAX_CHECKOUT_HOURS} hours.\n\n${newSession.primary}`,
  };
}
```
Import `DEFAULT_MAX_CHECKOUT_HOURS` at the top of the file.

- [ ] **Step 3: Update `completeSession` to reject check-outs >6h old**

Change the existing 24h rejection to 6h:
```typescript
const ageHours = (input.sentAt.getTime() - openSession.checkInAtUtc.getTime()) / 3600000;
if (ageHours > DEFAULT_MAX_CHECKOUT_HOURS) {
  await persistence.abandonSession(openSession.id, 'EXPIRED');
  return {
    primary: `Check-out rejected. You must check out within ${DEFAULT_MAX_CHECKOUT_HOURS} hours of check-in. Your previous session has been abandoned. Please check in again to start a new workout.`,
  };
}
```

- [ ] **Step 4: Add integration test for auto-abandon**

In `tests/integration/workflow.test.ts`, add:
```typescript
test('auto-abandons stale session and allows new check-in after 6 hours', async () => {
  // Simulate check-in 7 hours ago
  const oldCheckIn = new Date(Date.now() - 7 * 3600000);
  // ... create open session with oldCheckIn ...
  // Send new photo → expect auto-abandon + new check-in
});
```

- [ ] **Step 5: Run integration tests**

Run: `npx vitest run tests/integration/workflow.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/workout-service.ts src/services/persistence.ts tests/integration/workflow.test.ts
git commit -m "feat: auto-abandon stale sessions after 6 hours"
```

---

### Task 5: Update Weekly Rollup for Abandoned Sessions

**Files:**
- Modify: `src/domain/penalties.ts`
- Test: `tests/unit/penalties.test.ts`

- [ ] **Step 1: Verify abandoned sessions do not create `WorkoutDayCredit`**

By design, `completeSession` only creates a `WorkoutDayCredit` when a session reaches `COMPLETED`. `ABANDONED` sessions never get credits. No code change needed here, but verify in the rollup service that it only counts `WorkoutDayCredit` records.

- [ ] **Step 2: Add penalty test with abandoned session**

In `tests/unit/penalties.test.ts`, add:
```typescript
test('member with abandoned session fails target and owes penalty', () => {
  const results = [
    { userId: '1', completedDays: 5, metTarget: true },  // winner
    { userId: '2', completedDays: 4, metTarget: false }, // loser (1 day was abandoned)
  ];
  const distribution = calculatePenaltyDistribution(results, 1000, []);
  expect(distribution.get('2')).toEqual({ type: 'OWED', amount: 1000 });
  expect(distribution.get('1')).toEqual({ type: 'EARNED', amount: 1000 });
});
```

- [ ] **Step 3: Run penalty tests**

Run: `npx vitest run tests/unit/penalties.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/unit/penalties.test.ts
git commit -m "test: verify penalty distribution with abandoned sessions"
```

---

### Task 6: Implement `/voidsession` Command and Immediate Resolution

**Files:**
- Modify: `src/services/workout-photo-review-service.ts`
- Modify: `src/bot/create-bot.ts`
- Modify: `src/scheduler.ts`
- Test: `tests/unit/photo-review.test.ts`

- [ ] **Step 1: Add `beginVoidVote` method in `WorkoutPhotoReviewService`**

In `src/services/workout-photo-review-service.ts`:
```typescript
async beginVoidVote(
  groupId: string,
  initiatorUserId: string,
  targetUserId: string,
  sendMessage: (text: string, options?: object) => Promise<{ message_id: number }>
): Promise<{ primary: string } | { error: string }> {
  // Validate both are active participants
  // Find target's latest session in current week
  // Create WorkoutPhotoReview with reviewType: VOID_VOTE, deadline: now + 6h
  // Pre-create votes for eligible participants
  // Return message with voter mentions
}
```

- [ ] **Step 2: Add `resolveVoidVoteIfMajority` method**

```typescript
async resolveVoidVoteIfMajority(reviewId: string): Promise<void> {
  const review = await prisma.workoutPhotoReview.findUnique({
    where: { id: reviewId },
    include: { votes: true },
  });
  if (!review || review.status !== 'OPEN' || review.reviewType !== 'VOID_VOTE') return;

  const totalEligible = review.votes.length;
  const yesVotes = review.votes.filter(v => v.vote === true).length;
  const noVotes = review.votes.filter(v => v.vote === false).length;

  const majorityThreshold = Math.floor(totalEligible / 2) + 1;

  if (yesVotes >= majorityThreshold) {
    await this.invalidateSessionFromReview(review);
    await prisma.workoutPhotoReview.update({
      where: { id: reviewId },
      data: { status: 'PASSED', resolvedAt: new Date() },
    });
    // Send result message
  } else if (noVotes >= majorityThreshold) {
    await prisma.workoutPhotoReview.update({
      where: { id: reviewId },
      data: { status: 'FAILED', resolvedAt: new Date() },
    });
    // Send result message
  }
}
```

- [ ] **Step 3: Update `recordReactionVote` to call immediate resolution for void votes**

After recording a vote, if the review's `reviewType === 'VOID_VOTE'`, call `resolveVoidVoteIfMajority(review.id)`.

- [ ] **Step 4: Update scheduler to expire unresolved void votes**

In `src/scheduler.ts`, in `resolveExpiredReviews`:
```typescript
for (const review of expiredReviews) {
  if (review.reviewType === 'VOID_VOTE') {
    // No majority reached by deadline → FAILED (workout stands)
    await prisma.workoutPhotoReview.update({
      where: { id: review.id },
      data: { status: 'FAILED', resolvedAt: new Date() },
    });
    // Notify group
  } else {
    // existing CHALLENGE resolution logic
  }
}
```

- [ ] **Step 5: Add `/voidsession` command handler in `create-bot.ts`**

Add near the `/challengephoto` handler:
```typescript
bot.command('voidsession', async (ctx) => {
  // Parse target username from command args
  // Call WorkoutPhotoReviewService.beginVoidVote
  // Post review message and store reviewMessageId
});
```

- [ ] **Step 6: Create `tests/unit/photo-review.test.ts`**

```typescript
import { describe, test, expect, vi } from 'vitest';
import { resolveVoidVoteIfMajority } from '../../src/services/workout-photo-review-service.js';

describe('void vote resolution', () => {
  test('resolves PASSED when majority votes yes', async () => {
    // Mock prisma and test
  });

  test('resolves FAILED when majority votes no', async () => {
    // Mock prisma and test
  });

  test('does not resolve when no majority exists', async () => {
    // Mock prisma and test
  });
});
```

- [ ] **Step 7: Run new tests**

Run: `npx vitest run tests/unit/photo-review.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/services/workout-photo-review-service.ts src/bot/create-bot.ts src/scheduler.ts tests/unit/photo-review.test.ts
git commit -m "feat: add /voidsession command with immediate majority resolution"
```

---

### Task 7: Add 5-Hour Open Session Reminder

**Files:**
- Modify: `src/services/reminder-service.ts`
- Modify: `src/scheduler.ts`

- [ ] **Step 1: Add `sendExpiryReminders` to `ReminderService`**

In `src/services/reminder-service.ts`:
```typescript
async sendExpiryReminders(now: Date): Promise<void> {
  const sessions = await prisma.workoutSession.findMany({
    where: {
      status: 'OPEN',
      checkInAtUtc: {
        lte: new Date(now.getTime() - 5 * 3600000), // 5 hours old
        gte: new Date(now.getTime() - 5 * 3600000 - 60 * 1000), // within last minute
      },
    },
    include: { participant: { include: { user: true, group: true } } },
  });

  for (const session of sessions) {
    const groupId = session.participant.group.telegramGroupId;
    const username = session.participant.user.telegramUsername;
    await this.bot.api.sendMessage(
      groupId,
      `@${username}, you checked in 5 hours ago. You have 1 hour left to check out or this session will be abandoned.`
    );
  }
}
```

- [ ] **Step 2: Wire into scheduler**

In `src/scheduler.ts`, add:
```typescript
// Inside the cron job
try {
  await reminderService.sendExpiryReminders(now);
} catch (e) {
  logger.error({ err: e }, 'Failed to send expiry reminders');
}
```

- [ ] **Step 3: Commit**

```bash
git add src/services/reminder-service.ts src/scheduler.ts
git commit -m "feat: add 5-hour expiry reminder for open sessions"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Lint**

Run: `npx eslint src/ tests/`
Expected: No errors

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address review feedback and type issues" || echo "No changes to commit"
```
