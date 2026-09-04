-- Production onboarding and personalization domain. Existing profile values are
-- converted to the Prisma enum types before adding the new relationships.
CREATE TYPE "OnboardingDraftStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "OnboardingStep" AS ENUM ('GOAL', 'TRAINING_CONTEXT', 'EXPERIENCE', 'BODY_DATA', 'EQUIPMENT', 'LIMITATIONS', 'REMINDERS', 'NUTRITION', 'REVIEW');
CREATE TYPE "ProgramStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "AssignmentSource" AS ENUM ('ONBOARDING', 'ADMIN', 'TRAINER', 'USER');
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "WorkoutStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "WorkoutSource" AS ENUM ('ONBOARDING', 'USER', 'SYSTEM');
CREATE TYPE "NotificationType" AS ENUM ('WORKOUT_REMINDER');
CREATE TYPE "NotificationStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');
CREATE TYPE "NotificationSource" AS ENUM ('ONBOARDING', 'SYSTEM');

ALTER TABLE "UserProfile" ADD COLUMN "onboardingCompletedAt" timestamptz;

CREATE TABLE "OnboardingDraft" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "status" "OnboardingDraftStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "currentStep" "OnboardingStep" NOT NULL DEFAULT 'GOAL',
  "completedSteps" jsonb NOT NULL DEFAULT '[]',
  "draftData" jsonb NOT NULL DEFAULT '{}',
  "version" integer NOT NULL DEFAULT 1,
  "expiresAt" timestamptz NOT NULL,
  "completedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "OnboardingDraft_active_user_unique" ON "OnboardingDraft"("userId") WHERE "status" = 'IN_PROGRESS';
CREATE INDEX "OnboardingDraft_status_expiresAt_idx" ON "OnboardingDraft"("status", "expiresAt");
CREATE INDEX "OnboardingDraft_updatedAt_idx" ON "OnboardingDraft"("updatedAt");

CREATE TABLE "StarterProgram" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "status" "ProgramStatus" NOT NULL DEFAULT 'DRAFT',
  "active" boolean NOT NULL DEFAULT true,
  "goals" jsonb NOT NULL DEFAULT '[]',
  "levels" jsonb NOT NULL DEFAULT '[]',
  "locations" jsonb NOT NULL DEFAULT '[]',
  "workoutsPerWeek" integer NOT NULL,
  "durationMinutes" integer NOT NULL,
  "requiredEquipment" jsonb NOT NULL DEFAULT '[]',
  "contraindications" jsonb NOT NULL DEFAULT '[]',
  "firstWorkoutTitle" text NOT NULL DEFAULT 'Тренировка 1',
  "isFallback" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "StarterProgram_status_active_idx" ON "StarterProgram"("status", "active");

CREATE TABLE "UserProgramAssignment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "programId" uuid NOT NULL REFERENCES "StarterProgram"("id") ON DELETE RESTRICT,
  "source" "AssignmentSource" NOT NULL,
  "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "startedAt" timestamptz NOT NULL DEFAULT now(),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "programId", "source")
);
CREATE INDEX "UserProgramAssignment_userId_status_idx" ON "UserProgramAssignment"("userId", "status");

CREATE TABLE "Workout" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "programAssignmentId" uuid NOT NULL REFERENCES "UserProgramAssignment"("id") ON DELETE CASCADE,
  "status" "WorkoutStatus" NOT NULL DEFAULT 'PLANNED',
  "source" "WorkoutSource" NOT NULL,
  "scheduledFor" timestamptz NOT NULL,
  "title" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("programAssignmentId", "scheduledFor")
);
CREATE INDEX "Workout_userId_scheduledFor_idx" ON "Workout"("userId", "scheduledFor");

CREATE TABLE "Notification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "type" "NotificationType" NOT NULL,
  "scheduleDays" jsonb NOT NULL,
  "scheduleTime" text NOT NULL,
  "timezone" varchar(64) NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" "NotificationSource" NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "type", "source")
);

CREATE TABLE "IdempotencyKey" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "key" text NOT NULL,
  "requestHash" text NOT NULL,
  "responseStatus" integer NOT NULL,
  "responseBody" jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz NOT NULL,
  UNIQUE ("userId", "key")
);

CREATE TABLE "OutboxEvent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid REFERENCES "User"("id") ON DELETE SET NULL,
  "type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "publishedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");
