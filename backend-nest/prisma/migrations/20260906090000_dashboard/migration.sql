-- Dashboard read models and workout states used by the aggregation API.
ALTER TYPE "WorkoutStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "WorkoutStatus" ADD VALUE IF NOT EXISTS 'MISSED';

CREATE TYPE "DashboardSnapshotStatus" AS ENUM ('ACTIVE', 'INVALIDATED', 'EXPIRED');
CREATE TYPE "DashboardDayState" AS ENUM ('ONBOARDING_REQUIRED', 'WORKOUT_IN_PROGRESS', 'WORKOUT_PLANNED', 'REST_DAY', 'PROGRAM_REQUIRED', 'WORKOUT_MISSED');
CREATE TYPE "DashboardPrimaryActionType" AS ENUM ('RESUME_WORKOUT', 'CONTINUE_ONBOARDING', 'START_WORKOUT', 'RESCHEDULE_WORKOUT', 'VIEW_PROGRAM', 'CHOOSE_PROGRAM', 'REST_DAY');

CREATE TABLE "DashboardSnapshot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "localDate" date NOT NULL,
  "timezone" varchar(64) NOT NULL,
  "locale" varchar(8) NOT NULL,
  "algorithmVersion" varchar(32) NOT NULL,
  "snapshotData" jsonb NOT NULL,
  "sourceVersion" bigint NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "status" "DashboardSnapshotStatus" NOT NULL DEFAULT 'ACTIVE',
  "generatedAt" timestamptz NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "invalidatedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "localDate", "timezone", "locale", "algorithmVersion")
);
CREATE INDEX "DashboardSnapshot_userId_status_expiresAt_idx" ON "DashboardSnapshot"("userId", "status", "expiresAt");
CREATE INDEX "DashboardSnapshot_expiresAt_idx" ON "DashboardSnapshot"("expiresAt");

CREATE TABLE "UserDailyState" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "localDate" date NOT NULL,
  "timezone" varchar(64) NOT NULL,
  "state" "DashboardDayState" NOT NULL,
  "primaryActionType" "DashboardPrimaryActionType" NOT NULL,
  "activeWorkoutId" uuid,
  "plannedWorkoutId" uuid,
  "activeProgramId" uuid,
  "completedWorkoutCount" smallint NOT NULL DEFAULT 0,
  "plannedWorkoutCount" smallint NOT NULL DEFAULT 0,
  "sourceVersion" bigint NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "calculatedAt" timestamptz NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "localDate", "timezone")
);
CREATE INDEX "UserDailyState_userId_localDate_idx" ON "UserDailyState"("userId", "localDate");
CREATE INDEX "UserDailyState_state_expiresAt_idx" ON "UserDailyState"("state", "expiresAt");

ALTER TABLE "UserProgramAssignment" ADD COLUMN "rescheduleMissedWorkouts" boolean NOT NULL DEFAULT false;
ALTER TABLE "Workout" ADD COLUMN "startedAt" timestamptz;
ALTER TABLE "Workout" ADD COLUMN "completedAt" timestamptz;
ALTER TABLE "Workout" ADD COLUMN "estimatedDurationMinutes" integer;
ALTER TABLE "Workout" ADD COLUMN "version" integer NOT NULL DEFAULT 1;
ALTER TABLE "Workout" ADD COLUMN "updatedAt" timestamptz NOT NULL DEFAULT now();

CREATE TYPE "WorkoutSessionStatus" AS ENUM ('IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "WorkoutExerciseKind" AS ENUM ('STRENGTH', 'CARDIO', 'MOBILITY', 'OTHER');
CREATE TYPE "WorkoutSetStatus" AS ENUM ('PLANNED', 'COMPLETED', 'SKIPPED');
CREATE TABLE "WorkoutSession" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workoutId" uuid NOT NULL UNIQUE REFERENCES "Workout"("id") ON DELETE CASCADE,
  "status" "WorkoutSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "startedAt" timestamptz NOT NULL DEFAULT now(),
  "pausedAt" timestamptz,
  "completedAt" timestamptz,
  "durationSeconds" integer,
  "version" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "WorkoutSession_status_startedAt_idx" ON "WorkoutSession"("status", "startedAt");
CREATE TABLE "WorkoutExercise" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workoutId" uuid NOT NULL REFERENCES "Workout"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "kind" "WorkoutExerciseKind" NOT NULL DEFAULT 'STRENGTH',
  "position" integer NOT NULL,
  "completedAt" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("workoutId", "position")
);
CREATE INDEX "WorkoutExercise_workoutId_position_idx" ON "WorkoutExercise"("workoutId", "position");
CREATE TABLE "WorkoutSet" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "exerciseId" uuid NOT NULL REFERENCES "WorkoutExercise"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "status" "WorkoutSetStatus" NOT NULL DEFAULT 'PLANNED',
  "reps" integer,
  "weightKg" decimal(7,2),
  "durationSeconds" integer,
  "completedAt" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("exerciseId", "position")
);
CREATE INDEX "WorkoutSet_exerciseId_status_idx" ON "WorkoutSet"("exerciseId", "status");
CREATE TABLE "Measurement" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "weightKg" decimal(5,1),
  "measuredAt" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "Measurement_userId_measuredAt_idx" ON "Measurement"("userId", "measuredAt");
