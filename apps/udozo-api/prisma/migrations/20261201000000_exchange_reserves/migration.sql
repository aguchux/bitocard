-- The instant exchange: desks' reserves (money and coins), markups on the live market price, held quotes, trades and
-- finance's reserve movements (confirmed by an emailed code).
ALTER TYPE "AccountKind" ADD VALUE 'reserve_fiat';
ALTER TYPE "AccountKind" ADD VALUE 'reserve_crypto';

CREATE TABLE "exchange_markups" (
    "id" UUID NOT NULL,
    "desk" TEXT NOT NULL DEFAULT 'bitocard',
    "mode" "LedgerMode" NOT NULL,
    "asset" VARCHAR(10) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "buy_markup_bps" INTEGER NOT NULL DEFAULT 150,
    "sell_markup_bps" INTEGER NOT NULL DEFAULT 150,
    "min_fiat_minor" BIGINT NOT NULL DEFAULT 0,
    "max_fiat_minor" BIGINT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "exchange_markups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exchange_markups_bps_check" CHECK ("buy_markup_bps" BETWEEN 0 AND 2000 AND "sell_markup_bps" BETWEEN 0 AND 2000),
    CONSTRAINT "exchange_markups_limits_check" CHECK ("min_fiat_minor" >= 0 AND ("max_fiat_minor" IS NULL OR "max_fiat_minor" >= "min_fiat_minor"))
);
CREATE UNIQUE INDEX "exchange_markups_desk_mode_asset_currency_key" ON "exchange_markups"("desk", "mode", "asset", "currency");

CREATE TABLE "exchange_quotes" (
    "id" UUID NOT NULL,
    "desk" TEXT NOT NULL DEFAULT 'bitocard',
    "mode" "LedgerMode" NOT NULL,
    "customer_id" UUID NOT NULL,
    "side" TEXT NOT NULL,
    "asset" VARCHAR(10) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "fiat_minor" BIGINT NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "market_usd_e8" BIGINT NOT NULL,
    "market_at" TIMESTAMP(3),
    "fx_mid" DECIMAL(24,10) NOT NULL,
    "markup_bps" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exchange_quotes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exchange_quotes_side_check" CHECK ("side" IN ('buy', 'sell')),
    CONSTRAINT "exchange_quotes_amounts_check" CHECK ("amount" > 0 AND "fiat_minor" > 0 AND "price_minor" > 0)
);
CREATE INDEX "exchange_quotes_customer_id_created_at_idx" ON "exchange_quotes"("customer_id", "created_at");
ALTER TABLE "exchange_quotes" ADD CONSTRAINT "exchange_quotes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "exchange_trades" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "quote_id" UUID NOT NULL,
    "desk" TEXT NOT NULL DEFAULT 'bitocard',
    "mode" "LedgerMode" NOT NULL,
    "customer_id" UUID NOT NULL,
    "side" TEXT NOT NULL,
    "asset" VARCHAR(10) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "fiat_minor" BIGINT NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "market_usd_e8" BIGINT NOT NULL,
    "fx_mid" DECIMAL(24,10) NOT NULL,
    "markup_bps" INTEGER NOT NULL,
    "markup_minor" BIGINT NOT NULL,
    "from_proceeds" BIGINT NOT NULL DEFAULT 0,
    "from_wallet" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exchange_trades_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exchange_trades_side_check" CHECK ("side" IN ('buy', 'sell')),
    CONSTRAINT "exchange_trades_amounts_check" CHECK ("amount" > 0 AND "fiat_minor" > 0 AND "markup_minor" >= 0)
);
CREATE UNIQUE INDEX "exchange_trades_number_key" ON "exchange_trades"("number");
CREATE UNIQUE INDEX "exchange_trades_quote_id_key" ON "exchange_trades"("quote_id");
CREATE INDEX "exchange_trades_customer_id_created_at_idx" ON "exchange_trades"("customer_id", "created_at");
CREATE INDEX "exchange_trades_mode_created_at_idx" ON "exchange_trades"("mode", "created_at");
ALTER TABLE "exchange_trades" ADD CONSTRAINT "exchange_trades_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "reserve_movements" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "kind" TEXT NOT NULL,
    "reserve" TEXT NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "country" CHAR(2),
    "amount" BIGINT NOT NULL,
    "external_reference" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_code',
    "requested_by" UUID NOT NULL,
    "cancelled_by" UUID,
    "code_hash" TEXT,
    "code_expires_at" TIMESTAMP(3),
    "code_attempts" INTEGER NOT NULL DEFAULT 0,
    "code_sent_at" TIMESTAMP(3),
    "entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "reserve_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reserve_movements_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "reserve_movements_kind_check" CHECK ("kind" IN ('fund', 'withdraw')),
    CONSTRAINT "reserve_movements_reserve_check" CHECK (("reserve" = 'fiat' AND "country" IS NOT NULL) OR ("reserve" = 'crypto' AND "country" IS NULL)),
    CONSTRAINT "reserve_movements_status_check" CHECK ("status" IN ('awaiting_code', 'completed', 'cancelled'))
);
CREATE UNIQUE INDEX "reserve_movements_number_key" ON "reserve_movements"("number");
CREATE INDEX "reserve_movements_status_created_at_idx" ON "reserve_movements"("status", "created_at");
