-- Afrippa's escrow engine, step 3 item 4 (docs/CRYPTO_SPINOFF_PLAN.md): fees in crypto, both sides paying and the
-- seller more. Afrippa's admins set a buyer and a seller rate per coin, for one market or every market ('*'); a
-- market's own rate wins. Live trading needs a rate. A sell ad reserves its seller's fee on top of the coins it offers
-- (fee_locked), so buyers can take all of it; an order's seller fee comes from that reserve first, then the wallet
-- (seller_fee_from_lock), and goes back the same way if the order does not complete.
CREATE TABLE "p2p_fee_rates" (
    "id" UUID NOT NULL,
    "asset" VARCHAR(10) NOT NULL,
    "market" VARCHAR(2) NOT NULL,
    "buyer_bps" INTEGER NOT NULL,
    "seller_bps" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "p2p_fee_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "p2p_fee_rates_bounds" CHECK ("buyer_bps" BETWEEN 0 AND 1000 AND "seller_bps" BETWEEN 0 AND 1000),
    CONSTRAINT "p2p_fee_rates_market" CHECK ("market" = '*' OR "market" ~ '^[A-Z]{2}$')
);
CREATE UNIQUE INDEX "p2p_fee_rates_asset_market_key" ON "p2p_fee_rates"("asset", "market");
ALTER TABLE "p2p_fee_rates" ADD CONSTRAINT "p2p_fee_rates_asset_fkey" FOREIGN KEY ("asset") REFERENCES "crypto_assets"("code") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "p2p_ads" ADD COLUMN "fee_locked" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "p2p_ads" ADD CONSTRAINT "p2p_ads_fee_locked" CHECK ("fee_locked" >= 0 AND ("escrow" OR "fee_locked" = 0));
ALTER TABLE "p2p_orders" ADD COLUMN "seller_fee_from_lock" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "p2p_orders" ADD CONSTRAINT "p2p_orders_fee_from_lock" CHECK ("seller_fee_from_lock" >= 0 AND "seller_fee_from_lock" <= "seller_fee");
