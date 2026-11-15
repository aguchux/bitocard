-- Customers sell their gift cards to Prestmit through BitoCard (src/gift-card-sales).
CREATE TABLE "gift_card_sell_offers" (
    "id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'prestmit',
    "provider_card_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" VARCHAR(2),
    "country_label" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "minimum" INTEGER NOT NULL,
    "category_name" TEXT NOT NULL,
    "terms" TEXT,
    "brand" TEXT,
    "brand_set_by_admin" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "margin_bps" INTEGER,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gift_card_sell_offers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gift_card_sell_offers_margin_check" CHECK ("margin_bps" IS NULL OR ("margin_bps" >= 0 AND "margin_bps" <= 5000)),
    CONSTRAINT "gift_card_sell_offers_form_check" CHECK ("form" IN ('physical', 'ecode', 'both'))
);
CREATE UNIQUE INDEX "gift_card_sell_offers_provider_mode_provider_card_id_key" ON "gift_card_sell_offers"("provider", "mode", "provider_card_id");
CREATE INDEX "gift_card_sell_offers_mode_brand_country_idx" ON "gift_card_sell_offers"("mode", "brand", "country");

CREATE TABLE "gift_card_sales" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "customer_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "form" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "margin_bps" INTEGER NOT NULL,
    "quoted_minor" BIGINT NOT NULL,
    "provider_total_minor" BIGINT,
    "payout_minor" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'submitting',
    "provider_reference" TEXT,
    "rejection_reason" TEXT,
    "code_hint" TEXT,
    "photos" INTEGER NOT NULL DEFAULT 0,
    "checks" INTEGER NOT NULL DEFAULT 0,
    "next_check_at" TIMESTAMP(3),
    "entry_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gift_card_sales_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gift_card_sales_status_check" CHECK ("status" IN ('submitting', 'pending', 'completed', 'rejected', 'failed')),
    CONSTRAINT "gift_card_sales_form_check" CHECK ("form" IN ('physical', 'ecode')),
    CONSTRAINT "gift_card_sales_amounts_check" CHECK ("amount" > 0 AND "quoted_minor" >= 0 AND ("payout_minor" IS NULL OR "payout_minor" >= 0))
);
CREATE UNIQUE INDEX "gift_card_sales_number_key" ON "gift_card_sales"("number");
CREATE INDEX "gift_card_sales_customer_id_created_at_idx" ON "gift_card_sales"("customer_id", "created_at");
CREATE INDEX "gift_card_sales_status_next_check_at_idx" ON "gift_card_sales"("status", "next_check_at");
ALTER TABLE "gift_card_sales" ADD CONSTRAINT "gift_card_sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gift_card_sales" ADD CONSTRAINT "gift_card_sales_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "gift_card_sell_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
