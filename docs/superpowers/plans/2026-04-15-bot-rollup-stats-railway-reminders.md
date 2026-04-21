# Bot Rollup Stats Railway Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix weekly summary week selection, show total workout days beside hours, and add Railway trial/balance reminders tagged as test messages during this fixing phase.

**Architecture:** Keep business calculations in `src/domain` where practical, keep persistence-backed message building in existing services, and extend the existing minute scheduler. Railway trial reminders are env/config driven because Railway account billing data is not available inside this repo without an API token.

**Tech Stack:** TypeScript, Prisma, grammY, node-cron, Luxon, Vitest.

---

### Task 1: Weekly Summary Week Selection

**Files:**
- Modify: `src/domain/time.ts`
- Modify: `src/services/weekly-rollup-service.ts`
- Test: `tests/unit/time.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test proving Sunday 23:59 Bangkok summarizes the current local week and Monday 00:00 summarizes the prior week.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/time.test.ts`
Expected: FAIL because the new helper does not exist.

- [ ] **Step 3: Write minimal implementation**

Add `getWeekToSummarizeStart(reference, timezone)` and use it from weekly rollup.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/time.test.ts`
Expected: PASS.

### Task 2: Total Days in Bot Messages

**Files:**
- Modify: `src/services/workout-service.ts`
- Modify: `src/services/leaderboard-service.ts`
- Modify: `src/services/weekly-rollup-service.ts`
- Test: `tests/unit/leaderboard.test.ts`

- [ ] **Step 1: Write the failing test**

Add a pure formatter test for ranking rows showing weekly days, daily streak, total days, and total hours.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/leaderboard.test.ts`
Expected: FAIL because the formatter does not exist.

- [ ] **Step 3: Write minimal implementation**

Add a small formatter in `src/domain/leaderboard.ts` and use it in current leaderboard, post-workout rankings, and weekly summaries.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/leaderboard.test.ts`
Expected: PASS.

### Task 3: Railway Trial Reminder

**Files:**
- Modify: `src/config.ts`
- Modify: `src/services/reminder-service.ts`
- Modify: `src/scheduler.ts`
- Test: `tests/unit/time.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests for Railway reminder messages at 15, 2, and 1 days remaining and no message otherwise.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/time.test.ts`
Expected: FAIL because the reminder builder does not exist.

- [ ] **Step 3: Write minimal implementation**

Add optional config values for `RAILWAY_TRIAL_END_DATE`, `RAILWAY_BALANCE_REMAINING`, `RAILWAY_TRIAL_REMINDER_DAYS`, and `BOT_TEST_MESSAGE_PREFIX`; build and schedule idempotent reminders.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/time.test.ts`
Expected: PASS.

### Task 4: Verification

**Files:**
- All modified files.

- [ ] **Step 1: Run full tests**

Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: TypeScript compilation succeeds.
