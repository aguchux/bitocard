ALTER TYPE "AccountKind" ADD VALUE 'reseller_crypto';

CREATE TABLE "exchange_desks" (
  "reseller_id" UUID NOT NULL,
  "fallback_to_bitocard" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "exchange_desks_pkey" PRIMARY KEY ("reseller_id")
);
ALTER TABLE "exchange_desks" ADD CONSTRAINT "exchange_desks_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "reseller_desk_quotes" (
  "id" UUID NOT NULL,
  "reseller_id" UUID NOT NULL,
  "mode" "LedgerMode" NOT NULL,
  "side" TEXT NOT NULL,
  "asset" VARCHAR(10) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "amount" BIGINT NOT NULL,
  "fiat_minor" BIGINT NOT NULL,
  "price_minor" BIGINT NOT NULL,
  "market_usd_e8" BIGINT NOT NULL,
  "fx_mid" DECIMAL(24,10) NOT NULL,
  "markup_bps" INTEGER NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reseller_desk_quotes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reseller_desk_quotes_side_check" CHECK ("side" IN ('buy','sell')),
  CONSTRAINT "reseller_desk_quotes_amounts_check" CHECK ("amount" > 0 AND "fiat_minor" > 0 AND "price_minor" > 0)
);
CREATE INDEX "reseller_desk_quotes_reseller_id_mode_created_at_idx" ON "reseller_desk_quotes"("reseller_id","mode","created_at");
ALTER TABLE "reseller_desk_quotes" ADD CONSTRAINT "reseller_desk_quotes_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "reseller_desk_trades" (
  "id" UUID NOT NULL,
  "number" SERIAL NOT NULL,
  "quote_id" UUID NOT NULL,
  "reseller_id" UUID NOT NULL,
  "mode" "LedgerMode" NOT NULL,
  "side" TEXT NOT NULL,
  "asset" VARCHAR(10) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "amount" BIGINT NOT NULL,
  "fiat_minor" BIGINT NOT NULL,
  "price_minor" BIGINT NOT NULL,
  "markup_minor" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reseller_desk_trades_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reseller_desk_trades_side_check" CHECK ("side" IN ('buy','sell')),
  CONSTRAINT "reseller_desk_trades_amounts_check" CHECK ("amount" > 0 AND "fiat_minor" > 0 AND "price_minor" > 0 AND "markup_minor" >= 0)
);
CREATE UNIQUE INDEX "reseller_desk_trades_number_key" ON "reseller_desk_trades"("number");
CREATE UNIQUE INDEX "reseller_desk_trades_quote_id_key" ON "reseller_desk_trades"("quote_id");
CREATE INDEX "reseller_desk_trades_reseller_id_mode_created_at_idx" ON "reseller_desk_trades"("reseller_id","mode","created_at");
ALTER TABLE "reseller_desk_trades" ADD CONSTRAINT "reseller_desk_trades_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
