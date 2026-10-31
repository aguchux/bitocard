-- Crypto wallets and P2P trading: crypto balances live in the ledger (in each asset's base units), so ledger
-- currencies widen to fit asset codes such as USDT.
ALTER TYPE "AccountKind" ADD VALUE 'crypto_wallet';
ALTER TYPE "AccountKind" ADD VALUE 'crypto_locked';
ALTER TYPE "AccountKind" ADD VALUE 'crypto_frozen';
ALTER TYPE "AccountKind" ADD VALUE 'customer_withdrawable';
ALTER TYPE "AccountKind" ADD VALUE 'p2p_fiat_locked';
ALTER TYPE "AccountKind" ADD VALUE 'crypto_custody';
ALTER TYPE "AccountKind" ADD VALUE 'crypto_fees';

ALTER TABLE "ledger_accounts" ALTER COLUMN "currency" TYPE VARCHAR(10);

ALTER TABLE "customers" ADD COLUMN "crypto_frozen_at" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN "crypto_frozen_reason" TEXT;

CREATE TABLE "crypto_assets" (
    "code" VARCHAR(10) NOT NULL,
    "name" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "p2p_fee_bps" INTEGER NOT NULL DEFAULT 20,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crypto_assets_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "crypto_assets_decimals_check" CHECK ("decimals" BETWEEN 0 AND 8),
    CONSTRAINT "crypto_assets_fee_check" CHECK ("p2p_fee_bps" BETWEEN 0 AND 1000)
);

INSERT INTO "crypto_assets" ("code", "name", "decimals", "enabled", "sort_order") VALUES
    ('USDT', 'Tether USD', 6, true, 1),
    ('USDC', 'USD Coin', 6, true, 2),
    ('BTC', 'Bitcoin', 8, true, 3),
    ('ETH', 'Ether', 8, true, 4),
    ('BNB', 'BNB', 8, true, 5);

CREATE TABLE "crypto_freezes" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "asset" VARCHAR(10) NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'frozen',
    "frozen_by" UUID,
    "resolved_by" UUID,
    "resolve_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    CONSTRAINT "crypto_freezes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crypto_freezes_amount_check" CHECK ("amount" > 0)
);
CREATE INDEX "crypto_freezes_customer_id_status_idx" ON "crypto_freezes"("customer_id", "status");
ALTER TABLE "crypto_freezes" ADD CONSTRAINT "crypto_freezes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "p2p_profiles" (
    "customer_id" UUID NOT NULL,
    "nickname" TEXT NOT NULL,
    "nickname_key" TEXT NOT NULL,
    "chosen" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "p2p_profiles_pkey" PRIMARY KEY ("customer_id")
);
CREATE UNIQUE INDEX "p2p_profiles_nickname_key_key" ON "p2p_profiles"("nickname_key");
ALTER TABLE "p2p_profiles" ADD CONSTRAINT "p2p_profiles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "p2p_ads" (
    "id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "customer_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "asset" VARCHAR(10) NOT NULL,
    "side" TEXT NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "total_amount" BIGINT NOT NULL,
    "remaining_amount" BIGINT NOT NULL,
    "filled_amount" BIGINT NOT NULL DEFAULT 0,
    "min_fiat_minor" BIGINT NOT NULL,
    "max_fiat_minor" BIGINT NOT NULL,
    "fiat_locked_minor" BIGINT NOT NULL DEFAULT 0,
    "fiat_from_proceeds" BIGINT NOT NULL DEFAULT 0,
    "terms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "p2p_ads_pkey" PRIMARY KEY ("id"),
    -- The amounts an ad holds can never go below zero or past what it was posted with.
    CONSTRAINT "p2p_ads_amounts_check" CHECK ("remaining_amount" >= 0 AND "filled_amount" >= 0 AND "remaining_amount" + "filled_amount" = "total_amount" AND "price_minor" > 0),
    CONSTRAINT "p2p_ads_fiat_check" CHECK ("fiat_locked_minor" >= 0 AND "fiat_from_proceeds" >= 0 AND "fiat_from_proceeds" <= "fiat_locked_minor"),
    CONSTRAINT "p2p_ads_side_check" CHECK ("side" IN ('buy', 'sell')),
    CONSTRAINT "p2p_ads_status_check" CHECK ("status" IN ('active', 'paused', 'completed', 'cancelled'))
);
CREATE INDEX "p2p_ads_mode_country_asset_side_status_price_minor_idx" ON "p2p_ads"("mode", "country", "asset", "side", "status", "price_minor");
CREATE INDEX "p2p_ads_customer_id_status_idx" ON "p2p_ads"("customer_id", "status");
ALTER TABLE "p2p_ads" ADD CONSTRAINT "p2p_ads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "p2p_trades" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "ad_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "taker_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "asset" VARCHAR(10) NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "fee_amount" BIGINT NOT NULL,
    "fiat_minor" BIGINT NOT NULL,
    "fiat_from_proceeds" BIGINT NOT NULL DEFAULT 0,
    "fiat_from_wallet" BIGINT NOT NULL DEFAULT 0,
    "settlement" TEXT NOT NULL DEFAULT 'instant',
    "status" TEXT NOT NULL DEFAULT 'completed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "p2p_trades_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "p2p_trades_amounts_check" CHECK ("amount" > 0 AND "fee_amount" >= 0 AND "fee_amount" < "amount" AND "fiat_minor" > 0 AND "buyer_id" <> "seller_id")
);
CREATE UNIQUE INDEX "p2p_trades_number_key" ON "p2p_trades"("number");
CREATE INDEX "p2p_trades_buyer_id_created_at_idx" ON "p2p_trades"("buyer_id", "created_at");
CREATE INDEX "p2p_trades_seller_id_created_at_idx" ON "p2p_trades"("seller_id", "created_at");
CREATE INDEX "p2p_trades_ad_id_idx" ON "p2p_trades"("ad_id");
ALTER TABLE "p2p_trades" ADD CONSTRAINT "p2p_trades_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "p2p_ads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "p2p_trades" ADD CONSTRAINT "p2p_trades_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "p2p_trades" ADD CONSTRAINT "p2p_trades_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
