-- BitoCard Crypto: limits per P2P market (per trade, per 24 hours, tighter across borders) and the cross-border payout hold.
CREATE TABLE "crypto_market_limits" (
    "id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "market" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "per_trade_minor" BIGINT,
    "per_day_minor" BIGINT,
    "cross_border_per_trade_minor" BIGINT,
    "cross_border_per_day_minor" BIGINT,
    "cross_border_hold_days" INTEGER,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crypto_market_limits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crypto_market_limits_amounts_check" CHECK (
        ("per_trade_minor" IS NULL OR "per_trade_minor" > 0) AND ("per_day_minor" IS NULL OR "per_day_minor" > 0)
        AND ("cross_border_per_trade_minor" IS NULL OR "cross_border_per_trade_minor" > 0)
        AND ("cross_border_per_day_minor" IS NULL OR "cross_border_per_day_minor" > 0)
        AND ("cross_border_hold_days" IS NULL OR "cross_border_hold_days" BETWEEN 0 AND 365)
    )
);

CREATE UNIQUE INDEX "crypto_market_limits_mode_market_currency_key" ON "crypto_market_limits"("mode", "market", "currency");

-- Trades across borders (the global market, or a party from another country): their sale money waits longer.
ALTER TABLE "p2p_trades" ADD COLUMN "cross_border" BOOLEAN NOT NULL DEFAULT false;
