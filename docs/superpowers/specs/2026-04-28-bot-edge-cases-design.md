# Bot Edge Cases Design — Fitness Tracker

## Problem Statement

The fitness challenge bot has several edge cases in workout tracking, penalties, and photo review that need to be addressed:

1. **Stale Open Sessions Block New Check-Ins**: If a member forgets to check out and tries to check in the next day, the existing `OPEN` session (now >24h old) prevents a new check-in.
2. **Midnight Workouts Not Logged**: Workouts starting at 00:15 local time are not being credited correctly.
3. **Checkout Window Too Lenient**: The 24-hour checkout window allows users to game the system. A 6-hour limit is desired.
4. **Penalty Distribution**: When members fail to meet their weekly target, the 1,000 VAT penalty should be divided among all members who did meet the target that week.
5. **Photo Review / Void Session Flow**: The current `/challengephoto` flow is cumbersome. Users want a simpler way to vote a workout session as void when someone submits an invalid/stupid picture.

## Design

### 1. Auto-Abandon Stale Open Sessions (6-Hour Rule)

**New Rule**: A workout session must be checked out within **6 hours** of check-in. If not, the session is automatically abandoned and receives no credit.

**Behavior**:
- When a user sends a photo and `WorkoutService.handleWorkoutMessage` finds an existing `OPEN` session:
  - If `ageHours <= 6` → treat as normal check-out (existing behavior).
  - If `ageHours > 6` → **auto-abandon** the old session:
    - Update old session: `status: ABANDONED`, `abandonedAtUtc: now`, `abandonedReason: 'EXPIRED'`.
    - Start a **new check-in** session for the current photo.
    - Reply to user: inform them the previous session was abandoned because they didn't check out within 6 hours, and confirm the new check-in.
- When completing a check-out:
  - If `ageHours > 6` → reject with message: "Check-out rejected. You must check out within 6 hours of check-in. Your previous session has been abandoned. Please check in again to start a new workout."

**Schema Change**:
- Add `ABANDONED` to `SessionStatus` enum.
- Add `abandonedAtUtc?: DateTime` and `abandonedReason?: String` to `WorkoutSession` model.

**Domain Changes**:
- `domain/workout.ts`: Update `validateCheckOut` max age from 24h to 6h.
- `domain/constants.ts`: Add `DEFAULT_MAX_CHECKOUT_HOURS = 6` (or rename existing constant).

### 2. Fix Midnight Workout Logging

**Root Cause Hypothesis**: The `creditDateLocal` is computed from `input.sentAt` (UTC) using the group's timezone. At 00:15 local time, this should correctly map to the current local date. However, if there is any off-by-one in `domain/time.ts` or if the `WorkoutDayCredit` lookup in `completeSession` uses a different date boundary, the credit might not be created or might be looked up on the wrong day.

**Fix**:
- Audit `domain/time.ts` to ensure `localDate(utcDate, timezone)` correctly returns the local calendar date for times just after midnight.
- Add explicit unit tests for midnight boundary:
  - UTC time that maps to 00:15 local time → correct local date.
  - UTC time that maps to 23:59 local time → correct local date.
  - Week boundary at midnight (Sunday→Monday).
- In `WorkoutService.completeSession`, ensure the `alreadyCredited` check uses the exact same `creditDateLocal` string that was stored at check-in.
- Add debug logging around credit creation so future midnight issues are traceable.

### 3. Penalty Distribution (Weekly)

**Current Behavior**: `WeeklyRollupService` already distributes the penalty pool among successful members.

**Verification / Enhancement**:
- Confirm that `calculatePenaltyDistribution` in `domain/penalties.ts` handles the case correctly:
  - Failures owe `weeklyPenaltyAmount` (default 1,000).
  - Successes split `totalPool / winners.length` (floored).
  - If no winners, pool is marked `UNRESOLVED`.
- Ensure that members with `ABANDONED` sessions (no credit for that day) correctly reduce their weekly count, making them more likely to fail the target.
- Add unit test: member with 4 completed days + 1 abandoned session → fails target of 5 → penalty owed and distributed to winners.

### 4. Simplified "Void Session" Photo Review

**Current Flow**: `/challengephoto @username` → provide reason → 24h vote → resolve.

**Problems**:
- Requires a reason text message.
- 24-hour voting period is too long for simple voiding.
- Tie-breaking is complex.

**New Flow**: Keep the existing challenge photo for contested cases, but add a simpler **"Vote to Void"** flow:

**`/voidsession @username`** (admin or any active participant):
1. Find the target's **latest session in the current week** (OPEN, COMPLETED, or ABANDONED).
2. If the session is already INVALIDATED, reject.
3. Create a `WorkoutPhotoReview` with:
   - `status: OPEN`
   - `reviewType: VOID_VOTE` (new enum value)
   - `reviewDeadlineAt: now + 6 hours` (shorter window)
   - `requiredVoterCount: eligibleParticipants.length`
   - Pre-create votes for all eligible voters.
4. Post a message: "Vote to void @username's workout on [date]. React with 👍 to void, 👎 to keep. Majority wins, no tie-break."

**Voting**:
- Same reaction handler (`👍` / `👎`).
- Target cannot vote.
- Once majority is reached (>50% of eligible voters), resolve **immediately** (no need to wait for deadline).
- If deadline passes and no majority → session is **kept** (not voided).
- No tie-break mechanism for void votes. A tie at deadline means the workout stands.

**Resolution**:
- `PASSED` (majority 👍) → `invalidateSessionFromReview` → session `INVALIDATED`, credit deleted.
- `FAILED` (majority 👎 or no majority by deadline) → session stays as-is.

**Schema Changes**:
- Add `VOID_VOTE` to `WorkoutPhotoReviewType` (new enum, or extend existing).
- Add `reviewType` field to `WorkoutPhotoReview` to distinguish challenge vs void vote.

### 5. Daily Reminder for Open Sessions

To help users avoid abandoning sessions, add a **mid-session reminder**:
- Scheduler (already runs every minute) checks for `OPEN` sessions where `ageHours >= 5` (1 hour before expiry).
- Sends a DM or group reply: "@username, you checked in 5 hours ago. You have 1 hour left to check out or this session will be abandoned."

## Data Model Changes

```prisma
enum SessionStatus {
  OPEN
  COMPLETED
  INVALIDATED
  ABANDONED
}

model WorkoutSession {
  // ... existing fields ...
  abandonedAtUtc  DateTime?
  abandonedReason String?
}

enum WorkoutPhotoReviewType {
  CHALLENGE
  VOID_VOTE
}

model WorkoutPhotoReview {
  // ... existing fields ...
  reviewType WorkoutPhotoReviewType @default(CHALLENGE)
}
```

## Testing Strategy

1. **Unit Tests**:
   - `workout.test.ts`: 6-hour checkout rejection, auto-abandon on new check-in after 6h, midnight local date conversion.
   - `penalties.test.ts`: abandoned session reduces weekly count, penalty pool distribution with mixed results.
   - `time.test.ts`: midnight boundary tests.
   - New `photo-review.test.ts`: void vote majority resolution, deadline expiry, immediate resolution on majority.

2. **Integration Tests**:
   - End-to-end: check-in → wait 6h → new check-in auto-abandons old → check-out of new session → credit created.
   - End-to-end: void vote initiated → majority reached → session invalidated → credit removed.

## Files to Modify

- `prisma/schema.prisma` — new enum values and fields
- `src/domain/constants.ts` — `DEFAULT_MAX_CHECKOUT_HOURS = 6`
- `src/domain/workout.ts` — update validation rules
- `src/domain/time.ts` — audit + tests for midnight
- `src/services/workout-service.ts` — auto-abandon logic, 6-hour check-out
- `src/services/workout-photo-review-service.ts` — void vote flow, immediate resolution
- `src/services/reminder-service.ts` — 5-hour open session reminder
- `src/scheduler.ts` — resolve void votes immediately on majority, 5-hour reminder check
- `src/bot/create-bot.ts` — `/voidsession` command handler
- `tests/unit/workout.test.ts` — new test cases
- `tests/unit/penalties.test.ts` — abandoned session penalty tests
- `tests/unit/time.test.ts` — midnight boundary tests
- `tests/unit/photo-review.test.ts` — new file for void vote tests
