CREATE TYPE "WorkoutExerciseStatus" AS ENUM ('ACTIVE', 'REPLACED', 'REMOVED');
CREATE TYPE "WorkoutSetType" AS ENUM ('WARMUP', 'WORKING', 'DROP_SET', 'FAILURE', 'CUSTOM');
CREATE TYPE "WorkoutSkipReason" AS ENUM ('NO_TIME', 'TOO_HEAVY', 'PAIN_OR_DISCOMFORT', 'EQUIPMENT_UNAVAILABLE', 'USER_DECISION', 'OTHER');
CREATE TYPE "WorkoutRestTimerStatus" AS ENUM ('RUNNING', 'PAUSED', 'SKIPPED', 'COMPLETED');

ALTER TYPE "WorkoutStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "WorkoutSource" ADD VALUE IF NOT EXISTS 'PROGRAM';
ALTER TYPE "WorkoutSource" ADD VALUE IF NOT EXISTS 'TEMPLATE';
ALTER TYPE "WorkoutSource" ADD VALUE IF NOT EXISTS 'MANUAL';

ALTER TABLE "Workout" ALTER COLUMN "programAssignmentId" DROP NOT NULL;
ALTER TABLE "Workout" ADD COLUMN "cancelledAt" TIMESTAMPTZ;
ALTER TABLE "Workout" ADD COLUMN "durationSeconds" INTEGER;
ALTER TABLE "Workout" ADD COLUMN "totalVolumeKg" DECIMAL(12,2);
CREATE INDEX "Workout_userId_status_startedAt_idx" ON "Workout"("userId", "status", "startedAt");

ALTER TABLE "WorkoutExercise" ADD COLUMN "status" "WorkoutExerciseStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "WorkoutExercise" ADD COLUMN "muscleGroup" TEXT;
ALTER TABLE "WorkoutExercise" ADD COLUMN "equipment" TEXT;
ALTER TABLE "WorkoutExercise" ADD COLUMN "note" VARCHAR(500);

ALTER TABLE "WorkoutSet" ADD COLUMN "setType" "WorkoutSetType" NOT NULL DEFAULT 'WORKING';
ALTER TABLE "WorkoutSet" ADD COLUMN "plannedReps" INTEGER;
ALTER TABLE "WorkoutSet" ADD COLUMN "plannedWeightKg" DECIMAL(7,2);
ALTER TABLE "WorkoutSet" ADD COLUMN "actualReps" INTEGER;
ALTER TABLE "WorkoutSet" ADD COLUMN "actualWeightKg" DECIMAL(7,2);
ALTER TABLE "WorkoutSet" ADD COLUMN "rpe" DECIMAL(3,1);
ALTER TABLE "WorkoutSet" ADD COLUMN "rir" INTEGER;
ALTER TABLE "WorkoutSet" ADD COLUMN "restSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WorkoutSet" ADD COLUMN "skipReason" "WorkoutSkipReason";
ALTER TABLE "WorkoutSet" ADD COLUMN "note" VARCHAR(500);

CREATE TABLE "WorkoutRestTimer" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workoutId" UUID NOT NULL,
  "status" "WorkoutRestTimerStatus" NOT NULL DEFAULT 'RUNNING',
  "durationSeconds" INTEGER NOT NULL,
  "endsAt" TIMESTAMPTZ,
  "pausedRemainingSeconds" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkoutRestTimer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkoutRestTimer_workoutId_key" UNIQUE ("workoutId"),
  CONSTRAINT "WorkoutRestTimer_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE
);
