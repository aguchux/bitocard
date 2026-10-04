-- Platform fees on resellers' own integrations: rules in parts per billion, exact charges with a carried fraction.
ALTER TYPE "AccountKind" ADD VALUE 'platform_fees';

CREATE TYPE "FeeKind" AS ENUM ('supplier_order', 'gateway_payment');

CREATE TYPE "FeeChargeStatus" AS ENUM ('held', 'charged', 'released', 'refunded');

CREATE TABLE "fee_rules" (
    "id" UUID NOT NULL,
    "kind" "FeeKind" NOT NULL,
    "country_code" CHAR(2),
    "category" "ProductCategory",
    "plan_code" TEXT,
    "scope_key" TEXT NOT NULL,
    "rate_ppb" INTEGER NOT NULL,
    "min_fee_minor" BIGINT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fee_charges" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "kind" "FeeKind" NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "category" "ProductCategory",
    "country_code" CHAR(2),
    "plan_code" TEXT,
    "rule_id" UUID,
    "rate_ppb" INTEGER NOT NULL,
    "base_minor" BIGINT NOT NULL,
    "min_fee_minor" BIGINT,
    "exact_nano" BIGINT NOT NULL,
    "held_minor" BIGINT NOT NULL,
    "hold_id" UUID,
    "status" "FeeChargeStatus" NOT NULL DEFAULT 'held',
    "charged_minor" BIGINT,
    "carry_before_nano" BIGINT,
    "carry_after_nano" BIGINT,
    "extra_nano" BIGINT,
    "refund_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "fee_charges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fee_carries" (
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "carry_nano" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_carries_pkey" PRIMARY KEY ("reseller_id","mode","currency")
);

CREATE UNIQUE INDEX "fee_rules_scope_key_key" ON "fee_rules"("scope_key");

CREATE UNIQUE INDEX "fee_charges_reference_key" ON "fee_charges"("reference");

CREATE INDEX "fee_charges_reseller_id_mode_created_at_idx" ON "fee_charges"("reseller_id", "mode", "created_at");

CREATE INDEX "fee_charges_status_created_at_idx" ON "fee_charges"("status", "created_at");

ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rates stay within 0% and 10%; a carry is always less than one minor unit.
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_rate_ppb_check" CHECK ("rate_ppb" >= 0 AND "rate_ppb" <= 100000000);
ALTER TABLE "fee_carries" ADD CONSTRAINT "fee_carries_carry_check" CHECK ("carry_nano" >= 0 AND "carry_nano" < 1000000000);
