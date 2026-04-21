-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REMOVED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'COMPLETED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "AdminActionType" AS ENUM ('SETUP_GROUP', 'UPDATE_SETTINGS', 'ADD_PARTICIPANT', 'REMOVE_PARTICIPANT', 'PAUSE_PARTICIPANT', 'RESUME_PARTICIPANT', 'OVERRIDE_COMPLETE', 'OVERRIDE_PENALTY', 'RESET_WEEK', 'EXPORT_CSV');

-- CreateEnum
CREATE TYPE "ScheduledJobType" AS ENUM ('DAILY_REMINDER', 'LATE_REMINDER', 'WEEKLY_SUMMARY', 'WEEKLY_RESET');

-- CreateEnum
CREATE TYPE "ScheduledJobStatus" AS ENUM ('SUCCEEDED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "PenaltyLedgerType" AS ENUM ('OWED', 'EARNED', 'UNRESOLVED', 'MANUAL_ADJUSTMENT');

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "telegramTitle" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupSettings" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    "weeklyTarget" INTEGER NOT NULL DEFAULT 5,
    "weeklyPenaltyAmount" INTEGER NOT NULL DEFAULT 1000,
    "minSessionMinutes" INTEGER NOT NULL DEFAULT 20,
    "reminderTime" TEXT NOT NULL DEFAULT '20:00',
    "lateReminderTime" TEXT,
    "allowSelfPause" BOOLEAN NOT NULL DEFAULT true,
    "checkInTriggers" TEXT[],
    "checkOutTriggers" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupParticipant" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "resumedAt" TIMESTAMP(3),
    "currentWorkoutDayStreak" INTEGER NOT NULL DEFAULT 0,
    "longestWorkoutDayStreak" INTEGER NOT NULL DEFAULT 0,
    "currentSuccessfulWeekStreak" INTEGER NOT NULL DEFAULT 0,
    "longestSuccessfulWeekStreak" INTEGER NOT NULL DEFAULT 0,
    "lifetimeCompletedDays" INTEGER NOT NULL DEFAULT 0,
    "totalSuccessfulWeeks" INTEGER NOT NULL DEFAULT 0,
    "totalFailedWeeks" INTEGER NOT NULL DEFAULT 0,
    "totalPenaltiesOwed" INTEGER NOT NULL DEFAULT 0,
    "totalPenaltiesEarned" INTEGER NOT NULL DEFAULT 0,
    "lastCompletedWorkoutDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSession" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "checkInAtUtc" TIMESTAMP(3) NOT NULL,
    "checkOutAtUtc" TIMESTAMP(3),
    "creditDateLocal" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "checkInPhotoFileId" TEXT NOT NULL,
    "checkOutPhotoFileId" TEXT,
    "checkInCaption" TEXT,
    "checkOutCaption" TEXT,
    "durationMinutes" INTEGER,
    "invalidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutDayCredit" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "workoutSessionId" TEXT,
    "creditDateLocal" TEXT NOT NULL,
    "weekStartDateLocal" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkoutDayCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklySnapshot" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "weekStartDateLocal" TEXT NOT NULL,
    "weekEndDateLocal" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "weeklyTarget" INTEGER NOT NULL,
    "weeklyPenaltyAmount" INTEGER NOT NULL,
    "summaryMessage" TEXT,
    "unresolvedPenaltyPool" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyParticipantResult" (
    "id" TEXT NOT NULL,
    "weeklySnapshotId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "completedDays" INTEGER NOT NULL,
    "metTarget" BOOLEAN NOT NULL,
    "workoutsLeftAtClose" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "currentWorkoutDayStreak" INTEGER NOT NULL,
    "currentSuccessfulWeekStreak" INTEGER NOT NULL,
    "lifetimeCompletedDays" INTEGER NOT NULL,
    "totalSuccessfulWeeks" INTEGER NOT NULL,
    "totalFailedWeeks" INTEGER NOT NULL,
    "penaltyOwed" INTEGER NOT NULL DEFAULT 0,
    "penaltyEarned" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyParticipantResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PenaltyLedger" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "weeklySnapshotId" TEXT,
    "userId" TEXT,
    "type" "PenaltyLedgerType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PenaltyLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminActionLog" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actionType" "AdminActionType" NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledJobLog" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "jobType" "ScheduledJobType" NOT NULL,
    "jobKey" TEXT NOT NULL,
    "runAtUtc" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledJobStatus" NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledJobLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Group_telegramChatId_key" ON "Group"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupSettings_groupId_key" ON "GroupSettings"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramUserId_key" ON "User"("telegramUserId");

-- CreateIndex
CREATE INDEX "GroupParticipant_groupId_status_idx" ON "GroupParticipant"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GroupParticipant_groupId_userId_key" ON "GroupParticipant"("groupId", "userId");

-- CreateIndex
CREATE INDEX "WorkoutSession_groupId_userId_status_idx" ON "WorkoutSession"("groupId", "userId", "status");

-- CreateIndex
CREATE INDEX "WorkoutSession_groupId_creditDateLocal_idx" ON "WorkoutSession"("groupId", "creditDateLocal");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutDayCredit_workoutSessionId_key" ON "WorkoutDayCredit"("workoutSessionId");

-- CreateIndex
CREATE INDEX "WorkoutDayCredit_groupId_weekStartDateLocal_idx" ON "WorkoutDayCredit"("groupId", "weekStartDateLocal");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutDayCredit_groupId_userId_creditDateLocal_key" ON "WorkoutDayCredit"("groupId", "userId", "creditDateLocal");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklySnapshot_groupId_weekStartDateLocal_key" ON "WeeklySnapshot"("groupId", "weekStartDateLocal");

-- CreateIndex
CREATE INDEX "WeeklyParticipantResult_groupId_rank_idx" ON "WeeklyParticipantResult"("groupId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyParticipantResult_weeklySnapshotId_participantId_key" ON "WeeklyParticipantResult"("weeklySnapshotId", "participantId");

-- CreateIndex
CREATE INDEX "PenaltyLedger_groupId_createdAt_idx" ON "PenaltyLedger"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminActionLog_groupId_createdAt_idx" ON "AdminActionLog"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledJobLog_runAtUtc_idx" ON "ScheduledJobLog"("runAtUtc");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJobLog_groupId_jobType_jobKey_key" ON "ScheduledJobLog"("groupId", "jobType", "jobKey");

-- AddForeignKey
ALTER TABLE "GroupSettings" ADD CONSTRAINT "GroupSettings_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupParticipant" ADD CONSTRAINT "GroupParticipant_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupParticipant" ADD CONSTRAINT "GroupParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutDayCredit" ADD CONSTRAINT "WorkoutDayCredit_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutDayCredit" ADD CONSTRAINT "WorkoutDayCredit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklySnapshot" ADD CONSTRAINT "WeeklySnapshot_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyParticipantResult" ADD CONSTRAINT "WeeklyParticipantResult_weeklySnapshotId_fkey" FOREIGN KEY ("weeklySnapshotId") REFERENCES "WeeklySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyParticipantResult" ADD CONSTRAINT "WeeklyParticipantResult_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "GroupParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyParticipantResult" ADD CONSTRAINT "WeeklyParticipantResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenaltyLedger" ADD CONSTRAINT "PenaltyLedger_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenaltyLedger" ADD CONSTRAINT "PenaltyLedger_weeklySnapshotId_fkey" FOREIGN KEY ("weeklySnapshotId") REFERENCES "WeeklySnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenaltyLedger" ADD CONSTRAINT "PenaltyLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminActionLog" ADD CONSTRAINT "AdminActionLog_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminActionLog" ADD CONSTRAINT "AdminActionLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledJobLog" ADD CONSTRAINT "ScheduledJobLog_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

