CREATE TYPE "WorkoutPhotoReviewPhase" AS ENUM ('CHECK_IN', 'CHECK_OUT');

CREATE TYPE "WorkoutPhotoReviewStatus" AS ENUM ('OPEN', 'PASSED', 'FAILED');

ALTER TABLE "WorkoutSession"
ADD COLUMN "checkInMessageId" INTEGER,
ADD COLUMN "checkOutMessageId" INTEGER,
ALTER COLUMN "checkInPhotoFileId" DROP NOT NULL;

CREATE TABLE "WorkoutPhotoReview" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "workoutSessionId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "openedByUserId" TEXT NOT NULL,
  "phase" "WorkoutPhotoReviewPhase" NOT NULL,
  "status" "WorkoutPhotoReviewStatus" NOT NULL DEFAULT 'OPEN',
  "creditDateLocal" TEXT NOT NULL,
  "reason" TEXT,
  "reviewMessageId" INTEGER,
  "requiredVoterCount" INTEGER NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkoutPhotoReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkoutPhotoReviewVote" (
  "id" TEXT NOT NULL,
  "workoutPhotoReviewId" TEXT NOT NULL,
  "voterUserId" TEXT NOT NULL,
  "vote" BOOLEAN,
  "votedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkoutPhotoReviewVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkoutSession_groupId_checkInMessageId_key" ON "WorkoutSession"("groupId", "checkInMessageId");
CREATE UNIQUE INDEX "WorkoutSession_groupId_checkOutMessageId_key" ON "WorkoutSession"("groupId", "checkOutMessageId");
CREATE UNIQUE INDEX "WorkoutPhotoReview_reviewMessageId_key" ON "WorkoutPhotoReview"("reviewMessageId");
CREATE INDEX "WorkoutPhotoReview_groupId_status_createdAt_idx" ON "WorkoutPhotoReview"("groupId", "status", "createdAt");
CREATE UNIQUE INDEX "WorkoutPhotoReviewVote_workoutPhotoReviewId_voterUserId_key" ON "WorkoutPhotoReviewVote"("workoutPhotoReviewId", "voterUserId");
CREATE INDEX "WorkoutPhotoReviewVote_voterUserId_createdAt_idx" ON "WorkoutPhotoReviewVote"("voterUserId", "createdAt");

ALTER TABLE "WorkoutPhotoReview"
ADD CONSTRAINT "WorkoutPhotoReview_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "WorkoutPhotoReview_workoutSessionId_fkey" FOREIGN KEY ("workoutSessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "WorkoutPhotoReview_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "WorkoutPhotoReview_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkoutPhotoReviewVote"
ADD CONSTRAINT "WorkoutPhotoReviewVote_workoutPhotoReviewId_fkey" FOREIGN KEY ("workoutPhotoReviewId") REFERENCES "WorkoutPhotoReview"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "WorkoutPhotoReviewVote_voterUserId_fkey" FOREIGN KEY ("voterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
