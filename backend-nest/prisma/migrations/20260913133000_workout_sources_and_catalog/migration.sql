ALTER TYPE "WorkoutStatus" ADD VALUE IF NOT EXISTS 'ABANDONED';

CREATE TABLE "ProgramWorkout" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "programId" UUID NOT NULL REFERENCES "StarterProgram"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"), UNIQUE ("programId", "position")
);

CREATE TABLE "ExerciseCatalogItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "title" TEXT NOT NULL, "muscleGroup" TEXT NOT NULL,
  "movementType" TEXT, "equipment" TEXT, "difficulty" TEXT, "techniqueUrl" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE "ProgramWorkoutExercise" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "programWorkoutId" UUID NOT NULL REFERENCES "ProgramWorkout"("id") ON DELETE CASCADE,
  "exerciseId" UUID NOT NULL REFERENCES "ExerciseCatalogItem"("id"), "position" INTEGER NOT NULL, "plannedSets" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"), UNIQUE ("programWorkoutId", "position")
);

CREATE TABLE "WorkoutTemplate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "userId" UUID, "title" TEXT NOT NULL, "locked" BOOLEAN NOT NULL DEFAULT false,
  "exercises" JSONB NOT NULL DEFAULT '[]', "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE INDEX "WorkoutTemplate_userId_idx" ON "WorkoutTemplate"("userId");

ALTER TABLE "Workout" ADD COLUMN IF NOT EXISTS "templateId" UUID;
ALTER TABLE "Workout" ADD COLUMN IF NOT EXISTS "pausedDurationSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WorkoutExercise" ADD COLUMN IF NOT EXISTS "catalogExerciseId" UUID;
ALTER TABLE "WorkoutExercise" ADD COLUMN IF NOT EXISTS "techniqueUrl" TEXT;
ALTER TABLE "WorkoutExercise" ADD COLUMN IF NOT EXISTS "recommendedWeightKg" DECIMAL(7,2);
ALTER TABLE "WorkoutExercise" ADD COLUMN IF NOT EXISTS "lastPerformance" JSONB;
ALTER TABLE "WorkoutExercise" ADD COLUMN IF NOT EXISTS "replacedByExerciseId" UUID;

CREATE TABLE "WorkoutExerciseReplacement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workoutId" UUID NOT NULL REFERENCES "Workout"("id") ON DELETE CASCADE,
  "originalExerciseId" UUID NOT NULL, "replacementExerciseId" UUID NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE INDEX "WorkoutExerciseReplacement_workoutId_originalExerciseId_idx" ON "WorkoutExerciseReplacement"("workoutId", "originalExerciseId");
