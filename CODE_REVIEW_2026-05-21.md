# Code Review — Fitness Tracker Bot
**Date:** 2026-05-21  
**Scope:** Full codebase (`src/`, `prisma/`, `tests/`, infrastructure)  
**Deployed revision:** `fitness-tracker-bot-00009-xd9`

---

## 🔴 Critical Issues (Fix Immediately)

### C1. Missing Admin Checks on Sensitive Commands
**Files:** `src/bot/create-bot.ts`  
**Lines:** 197, 412, 426

| Command | Current Behavior | Risk |
|---|---|---|
| `/auditweek` | Any user can run it | Information disclosure, spam |
| `/challengephoto` | Any user can challenge another's workout | Abuse, harassment |
| `/voidsession` | Any user can start a void vote | Abuse, false invalidations |

**Fix:** Add `await requireAdmin(ctx)` at the top of each handler.

---

### C2. Race Condition — Duplicate Weekly Snapshots
**File:** `src/services/weekly-rollup-service.ts`  
**Lines:** 34-45

The idempotency check (`existingJob`) is **outside** the Prisma transaction. Two concurrent Cloud Run instances (or a restart during the job) could both see no existing job, then both run the full transaction. The `@@unique` on `ScheduledJobLog` only fails the second insert **after** duplicate snapshots, results, and ledger entries are created.

**Fix:** Move the existence check inside the transaction, or use an atomic `upsert` on `ScheduledJobLog` as a gate.

---

### C3. Race Condition — Duplicate Workout Sessions
**File:** `src/services/workout-service.ts`  
**Lines:** 42-54

`handleWorkoutMessage` queries for an `OPEN` session outside any transaction. Two concurrent photos from the same user could both find no open session and create two `OPEN` sessions. There is **no partial unique index** preventing multiple `OPEN` sessions per user.

**Fix:** Wrap lookup+create in a transaction, or add a partial unique index on `(groupId, userId)` where `status = 'OPEN'`.

---

### C4. Race Condition — Duplicate Workout Credits
**File:** `src/services/workout-service.ts`  
**Lines:** 157-221

`alreadyCreditedToday` is checked outside the transaction in `completeSession`. Between the check and the `workoutDayCredit.create` inside the transaction, another process could credit the same day. The `@@unique` constraint on `WorkoutDayCredit` prevents duplicate rows but causes a **hard Prisma error** that rolls back the entire transaction — leaving the `WorkoutSession` uncompleted despite the user sending a checkout photo.

**Fix:** Move the existence check inside the transaction and handle the unique constraint gracefully (upsert or try/catch).

---

### C5. Leaderboard Shows All-Time Minutes as "Current Week"
**File:** `src/services/leaderboard-service.ts`  
**Lines:** 27-39

```typescript
prisma.workoutSession.findMany({
  where: {
    groupId,
    status: SessionStatus.COMPLETED,
    durationMinutes: { not: null },
    // MISSING: creditDateLocal filter!
  },
})
```

The `sessions` query has **no date filter**. It accumulates every completed session ever. The leaderboard displays inflated lifetime hours as "current week" hours.

**Fix:** Add `creditDateLocal: { gte: weekStart, lte: weekEnd }` or `weekStartDateLocal: weekStart`.

---

### C6. `overrideComplete` Does NOT Update Participant Stats
**File:** `src/services/admin-service.ts`  
**Lines:** 136-179

`AdminService.overrideComplete` creates a `WorkoutDayCredit` but never updates `lifetimeCompletedDays`, `currentWorkoutDayStreak`, `longestWorkoutDayStreak`, or `lastCompletedWorkoutDate`. The participant's stats become permanently out of sync.

**Fix:** Replicate the streak/update logic from `WorkoutService.completeSession`.

---

### C7. Joined Date Uses UTC Instead of Local Timezone
**Files:** `src/services/leaderboard-service.ts`, `reminder-service.ts`, `weekly-rollup-service.ts`, `participant-service.ts`

Every caller computes `participantJoinedDateLocal` incorrectly:
```typescript
participantJoinedDateLocal: participant.joinedAt.toISOString().slice(0, 10)
```

`joinedAt` is a UTC Date. `toISOString().slice(0, 10)` extracts the **UTC date**, not the local Bangkok date.

**Impact:** Participants who join between **00:00–06:59 Bangkok time** (which is 17:00–23:59 previous day UTC) have their join date recorded as the **previous day**. This causes `getEffectiveWeeklyTarget` to assign an incorrect reduced target.

**Fix:** All callers should use `localDate(participant.joinedAt, timezone)` instead.

---

### C8. `UNRESOLVED` Penalties Are Invisible to Users
**File:** `src/domain/penalties.ts`  
**Lines:** 19-37

`summarizeLedgerRows` only sums `OWED` and `LEAVE_PENALTY`:
```typescript
const totalOwed = rows
  .filter((row) => row.type === 'OWED' || row.type === 'LEAVE_PENALTY')
  .reduce((sum, row) => sum + row.amount, 0);
```

`UNRESOLVED` is omitted. Therefore `/status`, `/mystats`, and `/cleardebt` show an incorrectly positive net balance when users have unresolved penalties.

**Fix:** Include `UNRESOLVED` in the `totalOwed` filter.

---

### C9. Cloud Run + In-Process Scheduler = Unreliable Cron
**File:** `src/scheduler.ts`

Cloud Run is request-driven and **scales to zero by default**. An in-process `node-cron` scheduler will:
- Stop ticking when no requests are incoming
- Lose all pending tick state on container freeze/thaw
- Miss reminders, weekly summaries, and week resets

**This is the single biggest operational risk.**

**Fix:** Enable "Always allocated CPU" + minimum 1 instance in Cloud Run, OR move scheduled jobs to Cloud Scheduler + Cloud Tasks, OR migrate to an always-on platform.

---

### C10. `buildWeekResultsAnnouncement` Uses Wrong Penalty Math
**File:** `src/services/weekly-rollup-service.ts`  
**Lines:** 399-501

When no snapshot exists, the fallback path does:
```typescript
const split = Math.floor((losers.length * penalty) / winners.length);
```

This:
- Ignores leave penalties
- Uses naive integer division — remainder money vanishes
- Is completely different from `calculatePenaltyDistribution` used in `runWeeklySummary`

**Users will see different penalty numbers depending on whether the weekly summary job has run yet.**

**Fix:** Always use `calculatePenaltyDistribution` for consistency.

---

## 🟠 High Issues (Fix This Week)

### H1. `recomputeParticipantStats` Sets Wrong Current Streak
**File:** `src/services/workout-service.ts`  
**Lines:** 532-585

The function sets `currentWorkoutDayStreak: runningStreak` where `runningStreak` is the streak at the **last credit date**, with no regard to whether that streak is still active. If a user's last workout was 5 days ago, `currentWorkoutDayStreak` is set to 3 instead of 0.

**Fix:** After computing the streak history, check if the last credit date was yesterday or today relative to "now"; otherwise set to 0.

---

### H2. Missing `joinedWeekStartDateLocal` on Participant Creation
**Files:** `src/services/admin-service.ts`, `src/services/participant-service.ts`

Both `addParticipant` and `join` create participants without setting `joinedWeekStartDateLocal`:
```typescript
create: {
  groupId, userId, status: ParticipantStatus.ACTIVE,
  // MISSING: joinedWeekStartDateLocal
}
```

This disables the reduced weekly target for users who join mid-week.

**Fix:** Set `joinedWeekStartDateLocal: startOfWeekLocal(new Date(), timezone)` on create.

---

### H3. Default Webhook Secret is `"change_me"`
**File:** `src/config.ts`  
**Line:** 11

If deployed without changing this, the webhook URL is easily guessable (`/telegram/webhook/change_me`), allowing anyone to spoof Telegram updates.

**Fix:** Remove the default. Make it required with `min(20)`.

---

### H4. No Rate Limiting — Chat Flooding Risk
**File:** `src/bot/create-bot.ts`

Any user can spam `/status`, `/leaderboard`, `/help`, `/mystats`, `/auditweek` (if not admin-locked). The text handler also replies to **every text message** from a user with an open session, which is extremely noisy.

**Fix:** Add per-user rate limiting (e.g., 1 command per 5 seconds).

---

### H5. `package.json` Start Script Points to Wrong Path
**File:** `package.json`

```json
"start": "node dist/index.js"
```

With `tsconfig.json` (`rootDir: "."`, `outDir: "dist"`), the emitted file is `dist/src/index.js`. The Dockerfile and `docker-compose.yml` correctly use `dist/src/index.js`, so this only breaks `npm start` locally.

**Fix:** Change to `"start": "node dist/src/index.js"`.

---

### H6. `overridepenalty` Can Pass `NaN`
**File:** `src/bot/create-bot.ts`  
**Lines:** 354-361

```typescript
const amount = parseInt(parts[1]!, 10);
```

There is no `Number.isNaN(amount)` check. If the user types `/overridepenalty @user not_a_number reason`, `NaN` is passed to `adminService.overridePenalty`.

**Fix:** Add validation: `if (Number.isNaN(amount) || amount <= 0)` throw error.

---

### H7. `/lastweekresults` vs Automated Summary Use Different Week Logic
- Automated summary (Sunday 23:59) uses `getWeekToSummarizeStart` → returns **current week's start** on Sunday
- `/lastweekresults` command uses `getPreviousWeekStart` → on Sunday returns **8 days ago**

**Impact:** If someone runs `/lastweekresults` on Sunday, they see results from **two weeks ago** instead of the week that is about to end.

**Fix:** Align both paths to use the same week-determination logic.

---

### H8. `/leavechallenge` Avoids Leave Penalty
**File:** `src/services/participant-service.ts`

`ParticipantService.leave` sets `REMOVED` and does NOT trigger a leave penalty. `AdminService.recordLeaveFromGroup` (triggered by Telegram group leave event) sets `LEFT_GROUP` and DOES charge a penalty. A user can avoid the penalty by using `/leavechallenge` instead of leaving the Telegram group.

**Fix:** Apply leave penalty in both paths, or remove the `/leavechallenge` command.

---

### H9. `buildWeekResultsAnnouncement` Snapshot vs Live Paths Diverge
**File:** `src/services/weekly-rollup-service.ts`

- Snapshot path: uses `snapshot.weeklyTarget` (uniform for all)
- Live path: uses per-participant effective target

A user who joined mid-week will show `3/3` in the live path but `3/5` in the snapshot path because snapshots store the global target.

**Fix:** Store per-participant target in the snapshot, or compute effective target when reading the snapshot.

---

### H10. Migrations Run on Every Container Start
**File:** `Dockerfile`

```dockerfile
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/index.js"]
```

In horizontally-scaling environments, concurrent containers race on `migrate deploy`. While Prisma migrations are mostly safe, this is still an anti-pattern.

**Fix:** Run migrations in a one-off deploy job, not in the runtime container startup.

---

## 🟡 Medium Issues (Fix When Convenient)

### M1. No Health Check Dependencies
**File:** `src/server.ts`

`/health` returns `{ ok: true }` without checking database connectivity, bot token validity, or Prisma migration status.

**Fix:** Query `prisma.$queryRaw` before returning `200`.

---

### M2. `APP_BASE_URL` Not Validated for Webhook Mode
**File:** `src/config.ts`

`APP_BASE_URL` is `.optional()` but runtime throws if webhook mode is chosen. Also, a trailing slash creates a double-slash URL.

**Fix:** Use Zod refinements or a discriminated union to enforce it when `BOT_MODE=webhook`.

---

### M3. Scheduler: Single Group Failure Aborts Entire Tick
**File:** `src/scheduler.ts`

If `reminderService.buildReminder()` throws (DB timeout, network blip), **all remaining groups** and **all expiry/review jobs** are skipped for that minute.

**Fix:** Wrap each group's processing in its own try/catch.

---

### M4. Scheduler: Single-Minute Time Windows Are Fragile
**File:** `src/scheduler.ts`

Jobs fire at exact times (`23:59`, `00:00`, `00:01`, `08:00`). If the previous tick is still running, the current tick is skipped entirely. If the container restarts mid-window, the job is missed. There is no catch-up.

**Fix:** Use a "missed window" detection or a more robust scheduling backend (Cloud Scheduler, BullMQ).

---

### M5. Input Validation Gaps in Admin Settings
**File:** `src/bot/create-bot.ts`

- `settarget`, `setpenalty`, `setminduration` accept negative numbers and zero
- `settimezone` accepts any string (e.g., `"Fake/Zone"`) with no IANA timezone validation
- `setremindertime` accepts any string with no HH:MM format validation

**Fix:** Add Zod or manual validation for each setting.

---

### M6. Missing Database Indexes
**File:** `prisma/schema.prisma`

| Table | Missing Index | Query Location |
|---|---|---|
| `PenaltyLedger` | `[groupId, userId]` | `clearDebt()`, `getStatus()` |
| `WorkoutSession` | `[status, checkInAtUtc]` | `sendExpiryReminders()` |
| `WorkoutSession` | `[groupId, userId, status, checkInAtUtc DESC]` | `handleWorkoutMessage()` |

**Fix:** Add `@index` directives in Prisma schema and regenerate.

---

### M7. `User` Model Has Dangerous Cascade Deletes
**File:** `prisma/schema.prisma`

Deleting a `User` cascades to almost everything: GroupParticipant, WorkoutSession, WorkoutDayCredit, WeeklyParticipantResult, AdminActionLog, votes, reviews.

**Fix:** Change audit tables to `SetNull` or `Restrict`.

---

### M8. `recordReminder` Swallows All Errors Silently
**File:** `src/services/reminder-service.ts`  
**Lines:** 166-182

```typescript
try {
  await prisma.scheduledJobLog.create({ ... });
  return true;
} catch {
  return false;
}
```

Any DB error (connection lost, timeout) returns `false`, masking operational problems.

**Fix:** Log the error before returning `false`.

---

### M9. No Webhook Cleanup When Switching to Polling
**File:** `src/index.ts`

If the bot was previously in webhook mode, Telegram continues POSTing to the old webhook URL when switching to polling.

**Fix:** Call `await bot.api.deleteWebhook()` in the polling branch.

---

### M10. `addparticipant` / `removeparticipant` Don't Verify Telegram Membership
**File:** `src/bot/create-bot.ts`

You can administratively add/remove users who have never joined the Telegram group.

**Fix:** Verify the target user is actually in the group chat.

---

## 🟢 Low Issues (Nice to Have)

### L1. `resolveUserByHandle` Uses Unnecessary Dynamic Import
**File:** `src/bot/create-bot.ts`  
**Line:** 618

`prisma` is already statically imported at the top of the file. The dynamic import adds latency and complexity for no benefit.

### L2. `resolveUserByHandle` Double-Normalizes Username
**File:** `src/bot/create-bot.ts`  
**Line:** 617

`toLowerCase()` is redundant with `mode: 'insensitive'`.

### L3. `exportcsv` Filename Not Unique
**File:** `src/bot/create-bot.ts`  
**Line:** 251

`fitness-${group.id}.csv` can be overwritten by concurrent exports.

### L4. `express.json()` Has No Explicit Size Limit
**File:** `src/server.ts`  
**Line:** 10

Should set a limit (e.g., `express.json({ limit: '100kb' })`).

### L5. `bot.catch` Does Not Reply to Users
**File:** `src/bot/create-bot.ts`  
**Lines:** 37-39

Unhandled errors in non-command handlers fail silently from the user's perspective.

### L6. Hardcoded Values in `group-service.ts`
**File:** `src/services/group-service.ts`

`getRules` hardcodes "Check-out window: 6 hours", "Max credit: 1 per calendar day", etc. These should be pulled from settings or constants.

### L7. `formatHours` Duplicated in 4+ Places
**Files:** `src/domain/leaderboard.ts`, `src/services/leaderboard-service.ts`, `src/services/workout-service.ts`, `src/services/weekly-rollup-service.ts`

### L8. `getEffectiveWeeklyTarget` Weekday Bug for Negative UTC Offsets
**File:** `src/domain/weekly-target.ts`  
**Lines:** 25-26

For timezones west of UTC, `T00:00:00Z` falls on the previous local day. Bangkok (UTC+7) is safe, but this is a latent bug.

### L9. `WorkoutPhotoReview` Allows Multiple Reviews Per Session
**File:** `src/services/workout-photo-review-service.ts`

There is no unique constraint preventing two void votes on the same `workoutSessionId`.

### L10. `logAdminAction` Called Outside Transactions
**File:** `src/services/admin-service.ts`

If logging fails, the audit trail is lost with no recovery.

---

## Test Coverage

| Metric | Value |
|---|---|
| Total test files | 8 |
| Lines of test code | ~474 |
| Domain functions tested | ~15 |
| **Service methods tested** | **0** |
| **Bot command handlers tested** | **0** |
| **Database-integrated tests** | **0** |
| **Estimated overall coverage** | **< 10%** |

### Completely Untested Critical Paths
- All admin commands (`/cleardebt`, `/overridepenalty`, `/complete`, etc.)
- All workout flow paths (check-in, check-out, expiry, cancellation)
- Weekly rollup (`runWeeklySummary`)
- Photo review system (challenges, void votes, tie-breaking)
- Scheduler tick behavior
- Race conditions and concurrency

---

## Recommended Priority Order

1. **Fix admin checks** (`/auditweek`, `/challengephoto`, `/voidsession`) — 5 min
2. **Fix leaderboard date filter** — 5 min
3. **Fix `UNRESOLVED` penalty visibility** — 5 min
4. **Fix joined date timezone bug** — 10 min
5. **Fix `overrideComplete` participant stats** — 15 min
6. **Add partial unique index on `OPEN` sessions** — 15 min
7. **Fix race conditions in weekly summary** — 20 min
8. **Fix `buildWeekResultsAnnouncement` penalty math** — 15 min
9. **Ensure Cloud Run always-on** or migrate scheduler — 1-2 hours
10. **Write tests for at least admin commands and workout flow** — 2-4 hours
