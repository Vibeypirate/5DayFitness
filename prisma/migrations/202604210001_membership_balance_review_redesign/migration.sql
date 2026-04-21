ALTER TYPE "ParticipantStatus" ADD VALUE IF NOT EXISTS 'LEFT_GROUP';
ALTER TYPE "PenaltyLedgerType" ADD VALUE IF NOT EXISTS 'LEAVE_PENALTY';
ALTER TYPE "WorkoutPhotoReviewStatus" ADD VALUE IF NOT EXISTS 'TIE_BREAK_PENDING';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PendingChallengeStatus') THEN
    CREATE TYPE "PendingChallengeStatus" AS ENUM ('WAITING_FOR_REASON', 'EXPIRED', 'COMPLETED');
  END IF;
END $$;

ALTER TABLE "GroupSettings"
  ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;

ALTER TABLE "GroupParticipant"
  ADD COLUMN IF NOT EXISTS "joinedWeekStartDateLocal" TEXT;

ALTER TABLE "WorkoutPhotoReview"
  ADD COLUMN IF NOT EXISTS "reviewDeadlineAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reminderLastSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tieBreakRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tieBreakMessageId" INTEGER;

ALTER TABLE "WorkoutPhotoReviewVote"
  ADD COLUMN IF NOT EXISTS "viaTieBreak" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS "PendingPhotoChallenge" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "WorkoutPhotoReview_tieBreakMessageId_key"
  ON "WorkoutPhotoReview"("tieBreakMessageId");

CREATE UNIQUE INDEX IF NOT EXISTS "PendingPhotoChallenge_groupId_challengerUserId_status_key"
  ON "PendingPhotoChallenge"("groupId", "challengerUserId", "status");

CREATE INDEX IF NOT EXISTS "PendingPhotoChallenge_groupId_expiresAt_idx"
  ON "PendingPhotoChallenge"("groupId", "expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'GroupSettings_ownerUserId_fkey'
  ) THEN
    ALTER TABLE "GroupSettings"
      ADD CONSTRAINT "GroupSettings_ownerUserId_fkey"
      FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'PendingPhotoChallenge_groupId_fkey'
  ) THEN
    ALTER TABLE "PendingPhotoChallenge"
      ADD CONSTRAINT "PendingPhotoChallenge_groupId_fkey"
      FOREIGN KEY ("groupId") REFERENCES "Group"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'PendingPhotoChallenge_challengerUserId_fkey'
  ) THEN
    ALTER TABLE "PendingPhotoChallenge"
      ADD CONSTRAINT "PendingPhotoChallenge_challengerUserId_fkey"
      FOREIGN KEY ("challengerUserId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'PendingPhotoChallenge_targetUserId_fkey'
  ) THEN
    ALTER TABLE "PendingPhotoChallenge"
      ADD CONSTRAINT "PendingPhotoChallenge_targetUserId_fkey"
      FOREIGN KEY ("targetUserId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
