-- SPEC-010: subscriptions & Telegram Stars
DO $$ BEGIN CREATE TYPE "SubscriptionTier" AS ENUM ('PRO', 'TRAINER_PRO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRING', 'CANCELLED', 'EXPIRED', 'REFUNDED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'REFUND_PENDING', 'REFUNDED', 'FAILED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "RefundRequestStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE "SubscriptionPlan" ADD VALUE IF NOT EXISTS 'TRAINER_PRO';

CREATE TABLE "subscription_plans" (
  "id" UUID PRIMARY KEY,
  "code" VARCHAR(64) NOT NULL UNIQUE,
  "tier" "SubscriptionTier" NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "period_days" SMALLINT NOT NULL CHECK ("period_days" BETWEEN 1 AND 366),
  "amount_stars" INTEGER NOT NULL CHECK ("amount_stars" BETWEEN 1 AND 2500000),
  "currency" CHAR(3) NOT NULL DEFAULT 'XTR' CHECK ("currency" = 'XTR'),
  "features" JSONB NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "auto_renewable" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Цена/период опубликованного плана неизменяемы: создавайте новый code/версию.
CREATE OR REPLACE FUNCTION subscription_plans_immutable_price() RETURNS trigger AS $$
BEGIN
  IF NEW.amount_stars <> OLD.amount_stars OR NEW.period_days <> OLD.period_days OR NEW.code <> OLD.code OR NEW.tier <> OLD.tier THEN
    RAISE EXCEPTION 'PLAN_PRICE_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER subscription_plans_immutable BEFORE UPDATE ON "subscription_plans" FOR EACH ROW EXECUTE FUNCTION subscription_plans_immutable_price();

CREATE TABLE "subscriptions" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "User"("id"),
  "plan_id" UUID NOT NULL REFERENCES "subscription_plans"("id"),
  "tier" "SubscriptionTier" NOT NULL,
  "product_scope" VARCHAR(32) NOT NULL DEFAULT 'FITTRACKER',
  "status" "SubscriptionStatus" NOT NULL,
  "auto_renew" BOOLEAN NOT NULL DEFAULT false,
  "current_period_start" TIMESTAMPTZ,
  "current_period_end" TIMESTAMPTZ,
  "telegram_subscription_charge_id" VARCHAR(255),
  "cancelled_at" TIMESTAMPTZ,
  "expired_at" TIMESTAMPTZ,
  "refunded_at" TIMESTAMPTZ,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ("status" NOT IN ('ACTIVE', 'EXPIRING') OR ("current_period_start" IS NOT NULL AND "current_period_end" IS NOT NULL))
);
CREATE INDEX "subscriptions_user_status_idx" ON "subscriptions"("user_id", "status");
CREATE INDEX "subscriptions_period_end_idx" ON "subscriptions"("current_period_end");
CREATE UNIQUE INDEX "subscriptions_one_access_per_scope" ON "subscriptions"("user_id", "product_scope") WHERE "status" IN ('ACTIVE', 'EXPIRING');

CREATE TABLE "payments" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "User"("id"),
  "plan_id" UUID NOT NULL REFERENCES "subscription_plans"("id"),
  "subscription_id" UUID REFERENCES "subscriptions"("id"),
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amount_stars" INTEGER NOT NULL CHECK ("amount_stars" BETWEEN 1 AND 2500000),
  "currency" CHAR(3) NOT NULL DEFAULT 'XTR' CHECK ("currency" = 'XTR'),
  "invoice_payload_hash" CHAR(64) NOT NULL UNIQUE,
  "invoice_link" TEXT,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "telegram_payment_charge_id" VARCHAR(255) UNIQUE,
  "provider_payment_charge_id" VARCHAR(255),
  "is_recurring" BOOLEAN NOT NULL DEFAULT false,
  "requires_manual_review" BOOLEAN NOT NULL DEFAULT false,
  "idempotency_key" VARCHAR(128),
  "paid_at" TIMESTAMPTZ,
  "refunded_at" TIMESTAMPTZ,
  "refund_reason" VARCHAR(64),
  "plan_snapshot" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "payments_user_created_idx" ON "payments"("user_id", "created_at" DESC, "id" DESC);
CREATE INDEX "payments_status_idx" ON "payments"("status", "paid_at");

CREATE TABLE "telegram_webhook_events" (
  "id" UUID PRIMARY KEY,
  "update_id" BIGINT NOT NULL UNIQUE,
  "event_type" VARCHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error_code" VARCHAR(80),
  "processed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "telegram_webhook_events_status_idx" ON "telegram_webhook_events"("status", "created_at");

CREATE TABLE "financial_idempotency_keys" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "User"("id"),
  "operation" VARCHAR(64) NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "response_status" INTEGER,
  "response_body" JSONB,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("user_id", "operation", "key")
);

CREATE TABLE "user_entitlements" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "entitlement" VARCHAR(64) NOT NULL,
  "subscription_id" UUID NOT NULL REFERENCES "subscriptions"("id"),
  "granted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expires_at" TIMESTAMPTZ NOT NULL,
  UNIQUE ("user_id", "entitlement")
);

CREATE TABLE "refund_requests" (
  "id" UUID PRIMARY KEY,
  "payment_id" UUID NOT NULL REFERENCES "payments"("id"),
  "actor_user_id" UUID NOT NULL REFERENCES "User"("id"),
  "reason" VARCHAR(64) NOT NULL,
  "status" "RefundRequestStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "refund_requests_one_per_payment" ON "refund_requests"("payment_id");

INSERT INTO "subscription_plans" ("id", "code", "tier", "title", "period_days", "amount_stars", "features", "auto_renewable") VALUES
  ('0192a000-0000-7000-8000-000000000001', 'PRO_MONTHLY', 'PRO', 'FitTracker Pro — 30 дней', 30, 399, '["UNLIMITED_PROGRAMS","UNLIMITED_CUSTOM_EXERCISES","ADVANCED_PROGRESS","FULL_HISTORY","PROGRESS_PHOTOS_UNLIMITED"]', true),
  ('0192a000-0000-7000-8000-000000000002', 'PRO_QUARTERLY', 'PRO', 'FitTracker Pro — 90 дней', 90, 999, '["UNLIMITED_PROGRAMS","UNLIMITED_CUSTOM_EXERCISES","ADVANCED_PROGRESS","FULL_HISTORY","PROGRESS_PHOTOS_UNLIMITED"]', false),
  ('0192a000-0000-7000-8000-000000000003', 'TRAINER_PRO_MONTHLY', 'TRAINER_PRO', 'FitTracker Trainer Pro — 30 дней', 30, 899, '["UNLIMITED_PROGRAMS","UNLIMITED_CUSTOM_EXERCISES","ADVANCED_PROGRESS","FULL_HISTORY","PROGRESS_PHOTOS_UNLIMITED","TRAINER_CLIENTS","TRAINER_PROGRAM_ASSIGNMENT"]', true)
ON CONFLICT ("code") DO NOTHING;
