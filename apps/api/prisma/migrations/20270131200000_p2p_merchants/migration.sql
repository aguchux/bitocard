-- Afrippa's merchants (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 6): traders who pass the thresholds apply, Afrippa's
-- operations approve; merchants get a badge, a filter of their own and the market's merchant limits.

CREATE TABLE "p2p_merchant_rules" (
    "market" VARCHAR(2) NOT NULL,
    "min_orders" INTEGER NOT NULL,
    "min_completion_bps" INTEGER NOT NULL,
    "window_days" INTEGER NOT NULL,
    "min_account_days" INTEGER NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "p2p_merchant_rules_pkey" PRIMARY KEY ("market"),
    CONSTRAINT "p2p_merchant_rules_values" CHECK ("min_orders" >= 0 AND "min_completion_bps" BETWEEN 0 AND 10000 AND "window_days" BETWEEN 1 AND 365 AND "min_account_days" >= 0)
);

-- All of Afrippa: 100 released orders, 98% completion over 90 days, an account 30 days old.
INSERT INTO "p2p_merchant_rules" ("market", "min_orders", "min_completion_bps", "window_days", "min_account_days") VALUES ('WW', 100, 9800, 90, 30);

CREATE TABLE "p2p_merchants" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "status" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "decided_by_id" UUID,
    "note" TEXT,
    "suspended_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "p2p_merchants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "p2p_merchants_status" CHECK ("status" IN ('applied', 'active', 'rejected', 'suspended', 'revoked')),
    CONSTRAINT "p2p_merchants_suspended_reason" CHECK ("suspended_reason" IS NULL OR "suspended_reason" IN ('strike', 'thresholds'))
);

CREATE UNIQUE INDEX "p2p_merchants_customer_id_mode_key" ON "p2p_merchants"("customer_id", "mode");
CREATE INDEX "p2p_merchants_mode_status_idx" ON "p2p_merchants"("mode", "status");
ALTER TABLE "p2p_merchants" ADD CONSTRAINT "p2p_merchants_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crypto_market_limits" ADD COLUMN "merchant_per_trade_minor" BIGINT, ADD COLUMN "merchant_per_day_minor" BIGINT;
ALTER TABLE "crypto_market_limits" ADD CONSTRAINT "crypto_market_limits_merchant_check" CHECK (("merchant_per_trade_minor" IS NULL OR "merchant_per_trade_minor" > 0) AND ("merchant_per_day_minor" IS NULL OR "merchant_per_day_minor" > 0));
