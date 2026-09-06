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
