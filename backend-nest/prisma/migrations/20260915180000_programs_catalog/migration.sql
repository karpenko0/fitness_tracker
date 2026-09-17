ALTER TYPE "ProgramStatus" ADD VALUE IF NOT EXISTS 'ACTIVE';
ALTER TYPE "ProgramStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "ProgramStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "ProgramStatus" ADD VALUE IF NOT EXISTS 'UNPUBLISHED';

DO $$ BEGIN
  CREATE TYPE "ProgramType" AS ENUM ('SYSTEM', 'USER_CUSTOM', 'TRAINER_ASSIGNED', 'AUTO_ASSIGNED', 'TEMPLATE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExerciseType" AS ENUM ('STRENGTH', 'BODYWEIGHT', 'MOBILITY', 'CARDIO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'PRO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "limitationTags" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "StarterProgram"
  ADD COLUMN IF NOT EXISTS "ownerId" UUID REFERENCES "User"("id"),
  ADD COLUMN IF NOT EXISTS "type" "ProgramType" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "goal" "FitnessGoal",
  ADD COLUMN IF NOT EXISTS "level" "ExperienceLevel",
  ADD COLUMN IF NOT EXISTS "location" "TrainingLocation",
  ADD COLUMN IF NOT EXISTS "durationWeeks" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS "estimatedWorkoutDurationMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "coverUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "isProOnly" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "StarterProgram"
SET
  "goal" = COALESCE("goal", NULLIF("goals"->>0, '')::"FitnessGoal"),
  "level" = COALESCE("level", NULLIF("levels"->>0, '')::"ExperienceLevel"),
  "location" = COALESCE("location", NULLIF("locations"->>0, '')::"TrainingLocation"),
  "estimatedWorkoutDurationMinutes" = COALESCE("estimatedWorkoutDurationMinutes", "durationMinutes");

CREATE INDEX IF NOT EXISTS "StarterProgram_ownerId_status_type_idx" ON "StarterProgram"("ownerId", "status", "type");

ALTER TABLE "ProgramWorkout"
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "focus" TEXT,
  ADD COLUMN IF NOT EXISTS "scheduledWeekday" INTEGER,
  ADD COLUMN IF NOT EXISTS "estimatedDurationMinutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "isRestDay" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "ProgramWorkout_programId_position_idx" ON "ProgramWorkout"("programId", "position");

ALTER TABLE "ExerciseCatalogItem"
  ADD COLUMN IF NOT EXISTS "ownerId" UUID REFERENCES "User"("id"),
  ADD COLUMN IF NOT EXISTS "slug" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "instructions" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "exerciseType" "ExerciseType" NOT NULL DEFAULT 'STRENGTH',
  ADD COLUMN IF NOT EXISTS "equipmentList" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "primaryMuscles" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "secondaryMuscles" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "safetyNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "media" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "alternativeExerciseIds" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "contraindications" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "isSystem" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "isProOnly" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ExerciseCatalogItem"
SET
  "equipmentList" = CASE WHEN "equipment" IS NULL OR "equipment" = '' THEN '[]'::jsonb ELSE jsonb_build_array("equipment") END,
  "primaryMuscles" = CASE
    WHEN "muscleGroup" ILIKE '%груд%' OR "muscleGroup" ILIKE '%chest%' THEN '["CHEST"]'::jsonb
    WHEN "muscleGroup" ILIKE '%спин%' OR "muscleGroup" ILIKE '%back%' THEN '["BACK"]'::jsonb
    WHEN "muscleGroup" ILIKE '%ног%' OR "muscleGroup" ILIKE '%quad%' THEN '["QUADRICEPS"]'::jsonb
    ELSE '["CORE"]'::jsonb
  END
WHERE "primaryMuscles" = '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS "ExerciseCatalogItem_slug_key" ON "ExerciseCatalogItem"("slug");
CREATE INDEX IF NOT EXISTS "ExerciseCatalogItem_active_difficulty_idx" ON "ExerciseCatalogItem"("active", "difficulty");
CREATE INDEX IF NOT EXISTS "ExerciseCatalogItem_ownerId_isSystem_idx" ON "ExerciseCatalogItem"("ownerId", "isSystem");

ALTER TABLE "ProgramWorkoutExercise"
  ADD COLUMN IF NOT EXISTS "plannedSetsCount" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "plannedRepsMin" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS "plannedRepsMax" INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS "plannedWeightKg" DECIMAL(7,2),
  ADD COLUMN IF NOT EXISTS "targetRpe" DECIMAL(3,1),
  ADD COLUMN IF NOT EXISTS "restSeconds" INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS "note" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "allowReplacement" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "alternativeExerciseIds" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "isOptional" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "ProgramWorkoutExercise_programWorkoutId_position_idx" ON "ProgramWorkoutExercise"("programWorkoutId", "position");

CREATE TABLE IF NOT EXISTS "ProgramExerciseSet" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "programExerciseId" UUID NOT NULL REFERENCES "ProgramWorkoutExercise"("id") ON DELETE CASCADE,
  "setNumber" INTEGER NOT NULL,
  "setType" "WorkoutSetType" NOT NULL DEFAULT 'WORKING',
  "plannedWeightKg" DECIMAL(7,2),
  "plannedRepsMin" INTEGER NOT NULL DEFAULT 8,
  "plannedRepsMax" INTEGER NOT NULL DEFAULT 12,
  "targetRpe" DECIMAL(3,1),
  "restSeconds" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  UNIQUE ("programExerciseId", "setNumber")
);

CREATE TABLE IF NOT EXISTS "ExerciseMuscle" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "exerciseId" UUID NOT NULL REFERENCES "ExerciseCatalogItem"("id") ON DELETE CASCADE,
  "muscle" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY ("id"),
  UNIQUE ("exerciseId", "muscle", "isPrimary")
);

CREATE TABLE IF NOT EXISTS "ExerciseEquipment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "exerciseId" UUID NOT NULL REFERENCES "ExerciseCatalogItem"("id") ON DELETE CASCADE,
  "equipment" TEXT NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("exerciseId", "equipment")
);

CREATE TABLE IF NOT EXISTS "ExerciseAlternative" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "exerciseId" UUID NOT NULL REFERENCES "ExerciseCatalogItem"("id") ON DELETE CASCADE,
  "alternativeExerciseId" UUID NOT NULL REFERENCES "ExerciseCatalogItem"("id") ON DELETE CASCADE,
  PRIMARY KEY ("id"),
  UNIQUE ("exerciseId", "alternativeExerciseId")
);

CREATE TABLE IF NOT EXISTS "ExerciseMedia" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "exerciseId" UUID NOT NULL REFERENCES "ExerciseCatalogItem"("id") ON DELETE CASCADE,
  "type" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ExerciseContraindication" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "exerciseId" UUID NOT NULL REFERENCES "ExerciseCatalogItem"("id") ON DELETE CASCADE,
  "tag" TEXT NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("exerciseId", "tag")
);

CREATE TABLE IF NOT EXISTS "SubscriptionEntitlement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
  "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
  "maxActiveCustomPrograms" INTEGER NOT NULL DEFAULT 1,
  "maxDraftCustomPrograms" INTEGER NOT NULL DEFAULT 2,
  "maxCustomExercises" INTEGER NOT NULL DEFAULT 10,
  "historyDays" INTEGER NOT NULL DEFAULT 30,
  "extendedStats" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserProgramAssignment_one_active" ON "UserProgramAssignment"("userId") WHERE "status" = 'ACTIVE';
