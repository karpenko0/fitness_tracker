-- Sync DB with schema.prisma for the history/progress module (SPEC-009): these models had no migration.
DO $$ BEGIN CREATE TYPE "MeasurementMetric" AS ENUM ('WEIGHT','NECK','CHEST','WAIST','ABDOMEN','HIPS','BICEPS_LEFT','BICEPS_RIGHT','THIGH_LEFT','THIGH_RIGHT','CALF_LEFT','CALF_RIGHT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ProgressPhotoPose" AS ENUM ('FRONT','SIDE_LEFT','SIDE_RIGHT','BACK','OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ProgressPhotoStatus" AS ENUM ('PENDING','READY','DELETED','FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ProgressAggregateMetric" AS ENUM ('VOLUME','WORKING_WEIGHT','ESTIMATED_1RM','BODY_WEIGHT','NECK','CHEST','WAIST','ABDOMEN','HIPS','BICEPS_LEFT','BICEPS_RIGHT','THIGH_LEFT','THIGH_RIGHT','CALF_LEFT','CALF_RIGHT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ProgressAggregateDimensionType" AS ENUM ('GLOBAL','PROGRAM','EXERCISE','MUSCLE_GROUP'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ProgressAggregateGroupBy" AS ENUM ('DAY','WEEK','MONTH'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ProgressAggregateUnit" AS ENUM ('KG','CM','COUNT','MINUTES'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Measurement: new columns; legacy "weightKg" is kept (nullable) and backfilled into MeasurementValue.
ALTER TABLE "Measurement" ADD COLUMN IF NOT EXISTS "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC';
ALTER TABLE "Measurement" ADD COLUMN IF NOT EXISTS "note" VARCHAR(500);
CREATE UNIQUE INDEX IF NOT EXISTS "Measurement_userId_measuredAt_timezone_key" ON "Measurement"("userId", "measuredAt", "timezone");

CREATE TABLE IF NOT EXISTS "MeasurementValue" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "measurementId" UUID NOT NULL REFERENCES "Measurement"("id") ON DELETE CASCADE,
  "metric" "MeasurementMetric" NOT NULL,
  "value" DECIMAL(5,1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "MeasurementValue_measurementId_metric_key" ON "MeasurementValue"("measurementId", "metric");

INSERT INTO "MeasurementValue" ("measurementId", "metric", "value")
SELECT "id", 'WEIGHT', "weightKg" FROM "Measurement" WHERE "weightKg" IS NOT NULL
ON CONFLICT ("measurementId", "metric") DO NOTHING;

CREATE TABLE IF NOT EXISTS "ProgressPhoto" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "measurementId" UUID REFERENCES "Measurement"("id"),
  "localDate" DATE NOT NULL,
  "pose" "ProgressPhotoPose" NOT NULL,
  "storageKey" TEXT NOT NULL,
  "previewStorageKey" TEXT,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "status" "ProgressPhotoStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "ProgressPhoto_userId_localDate_idx" ON "ProgressPhoto"("userId", "localDate");

CREATE TABLE IF NOT EXISTS "ProgressAggregate" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "metric" "ProgressAggregateMetric" NOT NULL,
  "dimensionType" "ProgressAggregateDimensionType" NOT NULL,
  "dimensionId" TEXT,
  "dimensionCode" TEXT,
  "localDate" DATE NOT NULL,
  "groupBy" "ProgressAggregateGroupBy" NOT NULL,
  "value" DECIMAL(20,2),
  "unit" "ProgressAggregateUnit" NOT NULL,
  "calculationVersion" VARCHAR(32) NOT NULL,
  "calculatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ProgressAggregate_lookup_idx" ON "ProgressAggregate"("userId", "metric", "dimensionType", "dimensionId", "dimensionCode", "localDate", "groupBy");
