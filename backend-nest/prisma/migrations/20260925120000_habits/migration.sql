-- SPEC-009: Habits module

DO $$ BEGIN
  CREATE TYPE "HabitType" AS ENUM ('WATER', 'STEPS', 'SLEEP', 'PROTEIN', 'MEDICATION', 'STRETCHING', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "HabitGoalType" AS ENUM ('COUNT', 'BOOLEAN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "HabitUnit" AS ENUM ('STEPS', 'ML', 'GRAMS', 'MINUTES', 'TIMES');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "HabitSchedule" AS ENUM ('DAILY', 'WEEKDAYS', 'ONE_TIME');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "HabitStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "HabitTaskStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "HabitTaskAction" AS ENUM ('ADD', 'SET');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "HabitNotificationStatus" AS ENUM ('SCHEDULED', 'SENT', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notificationsDisabled" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "Habit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "title" varchar(120) NOT NULL,
  "type" "HabitType" NOT NULL,
  "goalType" "HabitGoalType" NOT NULL,
  "goalValue" numeric(10,2),
  "unit" "HabitUnit",
  "schedule" "HabitSchedule" NOT NULL,
  "weekdays" integer[] NOT NULL DEFAULT ARRAY[]::integer[],
  "oneTimeDate" date,
  "timezone" text NOT NULL,
  "reminderTime" text,
  "telegramChatId" text,
  "status" "HabitStatus" NOT NULL DEFAULT 'ACTIVE',
  "pausedAt" timestamptz,
  "archivedAt" timestamptz,
  "currentStreak" integer NOT NULL DEFAULT 0,
  "bestStreak" integer NOT NULL DEFAULT 0,
  "version" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "Habit_userId_status_idx" ON "Habit" ("userId", "status");

CREATE TABLE IF NOT EXISTS "HabitTask" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "habitId" uuid NOT NULL REFERENCES "Habit"("id") ON DELETE CASCADE,
  "localDate" date NOT NULL,
  "status" "HabitTaskStatus" NOT NULL DEFAULT 'PENDING',
  "progressValue" numeric(10,2),
  "completedAt" timestamptz,
  "skippedAt" timestamptz,
  "expiredAt" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "HabitTask_habitId_localDate_key" UNIQUE ("habitId", "localDate")
);

CREATE INDEX IF NOT EXISTS "HabitTask_habitId_localDate_status_idx" ON "HabitTask" ("habitId", "localDate", "status");

CREATE TABLE IF NOT EXISTS "HabitTaskEvent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "taskId" uuid NOT NULL REFERENCES "HabitTask"("id") ON DELETE CASCADE,
  "action" "HabitTaskAction" NOT NULL,
  "value" numeric(10,2),
  "source" text NOT NULL DEFAULT 'API',
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "HabitTaskEvent_taskId_createdAt_idx" ON "HabitTaskEvent" ("taskId", "createdAt");

CREATE TABLE IF NOT EXISTS "HabitNotification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "habitId" uuid NOT NULL REFERENCES "Habit"("id") ON DELETE CASCADE,
  "taskLocalDate" date NOT NULL,
  "kind" text NOT NULL DEFAULT 'DAILY_REMINDER',
  "status" "HabitNotificationStatus" NOT NULL DEFAULT 'SCHEDULED',
  "attempts" integer NOT NULL DEFAULT 0,
  "lastError" text,
  "sentAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "HabitNotification_habitId_taskLocalDate_kind_key" UNIQUE ("habitId", "taskLocalDate", "kind")
);

CREATE INDEX IF NOT EXISTS "HabitNotification_status_habitId_idx" ON "HabitNotification" ("status", "habitId");
