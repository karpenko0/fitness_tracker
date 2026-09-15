ALTER TABLE "ExerciseCatalogItem" ADD COLUMN IF NOT EXISTS "bodyweightLoadFactor" DECIMAL(3,2);
ALTER TABLE "ExerciseCatalogItem" ADD COLUMN IF NOT EXISTS "weightIncrementKg" DECIMAL(7,2);

CREATE TYPE "PersonalRecordType" AS ENUM ('MAX_WEIGHT', 'MAX_REPS', 'ESTIMATED_1RM', 'MAX_EXERCISE_VOLUME', 'MAX_WORKOUT_VOLUME');
CREATE TYPE "PersonalRecordUnit" AS ENUM ('KG', 'REPS', 'KG_VOLUME');
CREATE TYPE "ProgressionConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'NONE');
CREATE TYPE "ProgressionReasonCode" AS ENUM ('PROGRESSIVE_OVERLOAD', 'MAINTAIN_LOAD', 'REDUCE_LOAD', 'PAIN_OR_DISCOMFORT', 'PLAN_VALUE', 'INSUFFICIENT_DATA');

CREATE TABLE "ExercisePerformance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "workoutId" UUID NOT NULL REFERENCES "Workout"("id") ON DELETE CASCADE, "exerciseId" UUID NOT NULL,
  "performedAt" TIMESTAMPTZ NOT NULL, "totalVolumeKg" DECIMAL(12,2), "maxWeightKg" DECIMAL(7,2),
  "maxReps" INTEGER, "bestEstimated1RmKg" DECIMAL(8,1), "completedSetsCount" SMALLINT NOT NULL,
  "skippedSetsCount" SMALLINT NOT NULL, "calculationVersion" VARCHAR(32) NOT NULL, "formulaVersion" VARCHAR(32) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("id"),
  UNIQUE ("userId", "workoutId", "exerciseId")
);
CREATE INDEX "ExercisePerformance_userId_exerciseId_performedAt_idx" ON "ExercisePerformance"("userId", "exerciseId", "performedAt" DESC);

CREATE TABLE "PersonalRecord" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "exerciseId" UUID, "recordType" "PersonalRecordType" NOT NULL, "value" DECIMAL(12,2) NOT NULL,
  "unit" "PersonalRecordUnit" NOT NULL, "sourceWorkoutId" UUID NOT NULL REFERENCES "Workout"("id") ON DELETE RESTRICT,
  "sourceSetId" UUID REFERENCES "WorkoutSet"("id") ON DELETE SET NULL, "previousValue" DECIMAL(12,2),
  "achievedAt" TIMESTAMPTZ NOT NULL, "calculationVersion" VARCHAR(32) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("id"),
  UNIQUE ("sourceWorkoutId", "exerciseId", "recordType")
);
CREATE INDEX "PersonalRecord_userId_exerciseId_recordType_idx" ON "PersonalRecord"("userId", "exerciseId", "recordType");

CREATE TABLE "ExerciseProgressionRecommendation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "exerciseId" UUID NOT NULL, "recommendedWeightKg" DECIMAL(7,2), "targetRepsMin" SMALLINT,
  "targetRepsMax" SMALLINT, "targetRpe" DECIMAL(3,1), "confidence" "ProgressionConfidence" NOT NULL,
  "reasonCode" "ProgressionReasonCode" NOT NULL, "basedOnWorkoutId" UUID, "algorithmVersion" VARCHAR(32) NOT NULL,
  "validUntil" TIMESTAMPTZ NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"), UNIQUE ("userId", "exerciseId", "algorithmVersion")
);
CREATE INDEX "ExerciseProgressionRecommendation_userId_exerciseId_idx" ON "ExerciseProgressionRecommendation"("userId", "exerciseId");

CREATE TABLE "WorkoutCalculation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workoutId" UUID NOT NULL UNIQUE REFERENCES "Workout"("id") ON DELETE CASCADE,
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "totalVolumeKg" DECIMAL(12,2),
  "completedSetsCount" SMALLINT NOT NULL, "skippedSetsCount" SMALLINT NOT NULL, "calculationVersion" VARCHAR(32) NOT NULL,
  "calculatedAt" TIMESTAMPTZ NOT NULL, "formulaVersion" VARCHAR(32) NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, PRIMARY KEY ("id")
);
CREATE INDEX "WorkoutCalculation_workoutId_idx" ON "WorkoutCalculation"("workoutId");
CREATE INDEX "Workout_userId_status_completedAt_idx" ON "Workout"("userId", "status", "completedAt" DESC);

CREATE TABLE "ProgressionAlgorithmConfig" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "algorithmVersion" VARCHAR(32) NOT NULL UNIQUE,
  "formulaVersion" VARCHAR(32) NOT NULL, "increasePercent" DECIMAL(5,2) NOT NULL DEFAULT 5,
  "decreasePercent" DECIMAL(5,2) NOT NULL DEFAULT 10, "maxIncreasePercent" DECIMAL(5,2) NOT NULL DEFAULT 10,
  "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("id")
);
INSERT INTO "ProgressionAlgorithmConfig" ("algorithmVersion", "formulaVersion") VALUES ('PROGRESSION_V1', 'EPLEY_V1') ON CONFLICT ("algorithmVersion") DO NOTHING;
