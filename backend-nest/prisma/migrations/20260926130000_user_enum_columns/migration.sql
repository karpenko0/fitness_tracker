-- Schema drift fix: schema.prisma declares these columns as enums, but the init migration created them as TEXT.
-- Prisma casts parameters to the enum type ("public"."UserStatus"), so INSERT into "User" failed on a fresh DB
-- (Telegram login → 500). Idempotent: creates types if missing and converts only columns that are still text.
DO $$ BEGIN CREATE TYPE "UserStatus" AS ENUM ('ACTIVE','PENDING_DELETION','DELETED','BLOCKED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "Gender" AS ENUM ('MALE','FEMALE','NOT_SPECIFIED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "FitnessGoal" AS ENUM ('WEIGHT_LOSS','MUSCLE_GAIN','MAINTENANCE','HEALTH','STRENGTH','FLEXIBILITY','ENDURANCE','MOBILITY_RECOVERY'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ExperienceLevel" AS ENUM ('BEGINNER','INTERMEDIATE','ADVANCED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "TrainingLocation" AS ENUM ('GYM','HOME','OUTDOOR','MIXED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE r record; dflt text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('User','status','UserStatus'),
    ('UserProfile','gender','Gender'),
    ('UserProfile','fitnessGoal','FitnessGoal'),
    ('UserProfile','experienceLevel','ExperienceLevel'),
    ('UserProfile','trainingLocation','TrainingLocation')
  ) AS t(tbl, col, typ)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col AND data_type = 'text') THEN
      SELECT column_default INTO dflt FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col;
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', r.tbl, r.col);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE %I USING NULLIF(%I, '''')::%I', r.tbl, r.col, r.typ, r.col, r.typ);
      IF dflt IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %s', r.tbl, r.col, replace(dflt, '::text', format('::%I', r.typ)));
      END IF;
    END IF;
  END LOOP;
END $$;
