-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('gift_cards', 'airtime', 'data', 'bills', 'pay_tv', 'esim', 'software', 'virtual_numbers', 'virtual_cards');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('draft', 'published', 'suspended');

-- AlterTable
ALTER TABLE "resellers" ADD COLUMN     "plan_code" TEXT NOT NULL DEFAULT 'standard';

-- CreateTable
CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reseller_signup" BOOLEAN NOT NULL DEFAULT false,
    "reserved_accounts" BOOLEAN NOT NULL DEFAULT false,
    "markup_cap_percent" INTEGER NOT NULL DEFAULT 50,
    "payout_hold_days" INTEGER NOT NULL DEFAULT 15,
    "min_withdrawal_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "country_categories" (
    "country_code" CHAR(2) NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "customer_verification" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "country_categories_pkey" PRIMARY KEY ("country_code","category")
);

-- CreateTable
CREATE TABLE "country_options" (
    "country_code" CHAR(2) NOT NULL,
    "key" TEXT NOT NULL,
    "allowed" TEXT[],
    "default_value" TEXT NOT NULL,

    CONSTRAINT "country_options_pkey" PRIMARY KEY ("country_code","key")
);

-- CreateTable
CREATE TABLE "reseller_options" (
    "reseller_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reseller_options_pkey" PRIMARY KEY ("reseller_id","key")
);

-- CreateTable
CREATE TABLE "feature_switches" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "country_code" CHAR(2),
    "reseller_id" UUID,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_switches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "features" TEXT[],
    "api_restrictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "status" "StoreStatus" NOT NULL DEFAULT 'draft',
    "logo_url" TEXT,
    "primary_color" TEXT NOT NULL DEFAULT '#070f4c',
    "accent_color" TEXT NOT NULL DEFAULT '#ff2382',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One switch per key and scope; NULLS NOT DISTINCT so the global and country scopes are unique too (edited by hand).
CREATE UNIQUE INDEX "feature_switches_key_country_code_reseller_id_key" ON "feature_switches"("key", "country_code", "reseller_id") NULLS NOT DISTINCT;

-- A switch has one scope: global, one country, or one reseller (edited by hand).
ALTER TABLE "feature_switches" ADD CONSTRAINT "feature_switches_one_scope" CHECK ("country_code" IS NULL OR "reseller_id" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "stores_subdomain_key" ON "stores"("subdomain");

-- CreateIndex
CREATE INDEX "stores_reseller_id_idx" ON "stores"("reseller_id");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- Reference data for the pilot. Admins change these later; values here are starting points.

-- Plans. Premium's price is a placeholder until an admin sets it (billing starts with wallets in M4).
INSERT INTO "plans" ("code", "name", "price_cents", "features", "api_restrictions", "updated_at") VALUES
  ('standard', 'Standard', 0, ARRAY[]::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP),
  ('premium', 'Premium', 2500, ARRAY['chargeback_protection', 'priority_support', 'international_selling']::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP);

-- Pilot countries. Minimum withdrawals are about USD 10 in local minor units.
INSERT INTO "countries" ("code", "name", "currency", "reseller_signup", "reserved_accounts", "markup_cap_percent", "payout_hold_days", "min_withdrawal_minor", "updated_at") VALUES
  ('NG', 'Nigeria', 'NGN', true, true, 50, 15, 1500000, CURRENT_TIMESTAMP),
  ('GH', 'Ghana', 'GHS', true, true, 50, 15, 15000, CURRENT_TIMESTAMP),
  ('KE', 'Kenya', 'KES', true, false, 50, 15, 130000, CURRENT_TIMESTAMP);

-- Categories: every category exists in every pilot country, switched on where a supplier is planned for launch.
-- Customers verify their identity for gift cards, virtual numbers and virtual cards; utilities need no verification.
INSERT INTO "country_categories" ("country_code", "category", "enabled", "customer_verification")
SELECT c.code, cat.category::"ProductCategory",
       (cat.category IN ('gift_cards', 'airtime', 'data') OR (c.code = 'NG' AND cat.category IN ('bills', 'pay_tv'))),
       cat.category IN ('gift_cards', 'virtual_numbers', 'virtual_cards')
FROM "countries" c
CROSS JOIN (VALUES ('gift_cards'), ('airtime'), ('data'), ('bills'), ('pay_tv'), ('esim'), ('software'), ('virtual_numbers'), ('virtual_cards')) AS cat(category);

-- Settings chain, BitoCard level. Gift-card sale payouts go to wallets only where reserved accounts exist.
-- Fixed-price products earn by markup; admins can also allow "discount" (sell at face value, earn BitoCard's discount).
INSERT INTO "country_options" ("country_code", "key", "allowed", "default_value") VALUES
  ('NG', 'gift_card_payout', ARRAY['wallet', 'bank']::TEXT[], 'wallet'),
  ('GH', 'gift_card_payout', ARRAY['wallet', 'bank']::TEXT[], 'wallet'),
  ('KE', 'gift_card_payout', ARRAY['bank']::TEXT[], 'bank'),
  ('NG', 'fixed_price_earning', ARRAY['markup']::TEXT[], 'markup'),
  ('GH', 'fixed_price_earning', ARRAY['markup']::TEXT[], 'markup'),
  ('KE', 'fixed_price_earning', ARRAY['markup']::TEXT[], 'markup');

-- AddForeignKey
ALTER TABLE "resellers" ADD CONSTRAINT "resellers_country_fkey" FOREIGN KEY ("country") REFERENCES "countries"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resellers" ADD CONSTRAINT "resellers_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "plans"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "country_categories" ADD CONSTRAINT "country_categories_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "country_options" ADD CONSTRAINT "country_options_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_options" ADD CONSTRAINT "reseller_options_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_switches" ADD CONSTRAINT "feature_switches_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

