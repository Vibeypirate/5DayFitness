-- CreateEnum
CREATE TYPE "WorkoutPhotoReviewType" AS ENUM ('CHALLENGE', 'VOID_VOTE');

-- AlterEnum
ALTER TYPE "SessionStatus" ADD VALUE 'ABANDONED';

-- AlterTable
ALTER TABLE "WorkoutPhotoReview" ADD COLUMN     "reviewType" "WorkoutPhotoReviewType" NOT NULL DEFAULT 'CHALLENGE';

-- AlterTable
ALTER TABLE "WorkoutSession" ADD COLUMN     "abandonedAtUtc" TIMESTAMP(3),
ADD COLUMN     "abandonedReason" TEXT;
