-- Drop tables if exist for reset
DROP TABLE IF EXISTS "AuditLog";
DROP TABLE IF EXISTS "AuthSession";
DROP TABLE IF EXISTS "UserRole";
DROP TABLE IF EXISTS "Role";
DROP TABLE IF EXISTS "UserProfile";
DROP TABLE IF EXISTS "User";

CREATE TABLE "User" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "telegramId" bigint NOT NULL UNIQUE,
  "telegramUsername" varchar(255),
  "firstName" varchar(255) NOT NULL,
  "lastName" varchar(255),
  "telegramLanguageCode" varchar(16),
  "telegramPhotoUrl" text,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "lastLoginAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "deletedAt" timestamptz
);

CREATE TABLE "UserProfile" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
  "gender" text,
  "birthDate" date,
  "heightCm" int,
  "weightKg" decimal(5,1),
  "fitnessGoal" text,
  "experienceLevel" text,
  "trainingLocation" text,
  "trainingFrequency" int,
  "preferredWorkoutDuration" int,
  "equipment" jsonb NOT NULL DEFAULT '[]',
  "limitations" text,
  "trainingPreferences" jsonb NOT NULL DEFAULT '[]',
  "nutritionPlanNeeded" boolean NOT NULL DEFAULT false,
  "notificationDays" jsonb NOT NULL DEFAULT '[]',
  "notificationTime" time,
  "locale" varchar(8) NOT NULL DEFAULT 'ru',
  "timezone" varchar(64) NOT NULL DEFAULT 'UTC',
  "onboardingCompleted" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Role" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" varchar(64) NOT NULL UNIQUE,
  "name" varchar(128) NOT NULL,
  "description" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "UserRole" (
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "roleId" uuid NOT NULL REFERENCES "Role"("id") ON DELETE CASCADE,
  "assignedById" uuid REFERENCES "User"("id") ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", "roleId")
);

CREATE TABLE "AuthSession" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "refreshTokenHash" varchar(255) NOT NULL,
  "ipHash" varchar(255),
  "userAgent" text,
  "expiresAt" timestamptz NOT NULL,
  "revokedAt" timestamptz,
  "revokedReason" varchar(128),
  "lastUsedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "AuditLog" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actorUserId" uuid REFERENCES "User"("id") ON DELETE SET NULL,
  "targetUserId" uuid REFERENCES "User"("id") ON DELETE SET NULL,
  "action" varchar(128) NOT NULL,
  "entityType" varchar(128) NOT NULL,
  "entityId" uuid,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "requestId" varchar(128),
  "ipHash" varchar(255),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "User_status_idx" ON "User"("status");
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");
CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId", "revokedAt");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
CREATE INDEX "AuthSession_refreshTokenHash_idx" ON "AuthSession"("refreshTokenHash");
