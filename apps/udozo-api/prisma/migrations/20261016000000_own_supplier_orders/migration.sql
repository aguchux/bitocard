-- Own-supplier orders: resellers' own offers, routing preference, and the source and fee on quotes and orders.
CREATE TYPE "ConnectionRouting" AS ENUM ('preferred', 'fallback', 'off');

ALTER TABLE "reseller_connections" ADD COLUMN "routing" "ConnectionRouting" NOT NULL DEFAULT 'preferred',
ADD COLUMN "last_synced_at" TIMESTAMP(3),
ADD COLUMN "last_sync_error" TEXT;

ALTER TABLE "quotes" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'bitocard',
ADD COLUMN "connection_id" UUID,
ADD COLUMN "fee_rule_id" UUID,
ADD COLUMN "fee_rate_ppb" INTEGER,
ADD COLUMN "fee_base_minor" BIGINT,
ADD COLUMN "fee_min_minor" BIGINT,
ADD COLUMN "fee_max_minor" BIGINT;

ALTER TABLE "orders" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'bitocard',
ADD COLUMN "connection_id" UUID,
ADD COLUMN "fee_charge_id" UUID,
ADD COLUMN "fee_minor" BIGINT;

CREATE TABLE "reseller_offers" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "cost_currency" CHAR(3) NOT NULL,
    "cost_ratio" DECIMAL(24,10) NOT NULL,
    "cost_fee_minor" BIGINT NOT NULL DEFAULT 0,
    "meta" JSONB,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reseller_offers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reseller_offers_reseller_id_mode_product_id_idx" ON "reseller_offers"("reseller_id", "mode", "product_id");

CREATE UNIQUE INDEX "reseller_offers_connection_id_sku_key" ON "reseller_offers"("connection_id", "sku");

ALTER TABLE "reseller_offers" ADD CONSTRAINT "reseller_offers_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "reseller_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reseller_offers" ADD CONSTRAINT "reseller_offers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
