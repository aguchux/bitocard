-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('mvp_live', 'mvp_qualify', 'pilot', 'later', 'backup');

-- CreateEnum
CREATE TYPE "DenominationType" AS ENUM ('fixed', 'range');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('open', 'used');

-- AlterTable
ALTER TABLE "country_categories" ADD COLUMN     "taxable" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "suppliers" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categories" "ProductCategory"[],
    "coverage" TEXT NOT NULL,
    "status" "SupplierStatus" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "billing_model" TEXT,
    "funding_currency" CHAR(3),
    "min_first_deposit_minor" BIGINT,
    "min_top_up_minor" BIGINT,
    "fees" TEXT,
    "refunds" TEXT,
    "resale_approved" BOOLEAN NOT NULL DEFAULT false,
    "requires_ip_allowlist" BOOLEAN,
    "notes" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "supplier_markets" (
    "supplier_code" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "supplier_markets_pkey" PRIMARY KEY ("supplier_code","country_code","category")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "country" CHAR(2) NOT NULL,
    "brand" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "face_currency" CHAR(3) NOT NULL,
    "denomination_type" "DenominationType" NOT NULL,
    "fixed_values" BIGINT[] DEFAULT ARRAY[]::BIGINT[],
    "min_value_minor" BIGINT,
    "max_value_minor" BIGINT,
    "recipient_type" TEXT NOT NULL DEFAULT 'none',
    "description" TEXT,
    "redeem_instructions" TEXT,
    "logo_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_products" (
    "id" UUID NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "cost_currency" CHAR(3) NOT NULL,
    "cost_ratio" DECIMAL(24,10) NOT NULL,
    "cost_fee_minor" BIGINT NOT NULL DEFAULT 0,
    "discount_bps" INTEGER NOT NULL DEFAULT 0,
    "meta" JSONB,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" UUID NOT NULL,
    "category" "ProductCategory",
    "country_code" CHAR(2),
    "product_id" UUID,
    "margin_bps" INTEGER NOT NULL,
    "reseller_discount_bps" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reseller_markups" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "product_id" UUID,
    "markup_bps" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reseller_markups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "face_value_minor" BIGINT NOT NULL,
    "face_currency" CHAR(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "wholesale_minor" BIGINT NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "tax_minor" BIGINT NOT NULL,
    "tax_name" TEXT,
    "tax_rate_bps" INTEGER,
    "reseller_profit_minor" BIGINT NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "supplier_product_id" UUID NOT NULL,
    "supplier_cost_minor" BIGINT NOT NULL,
    "supplier_currency" CHAR(3) NOT NULL,
    "fx_rate" DECIMAL(24,10),
    "recipient" JSONB,
    "customer_reference" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'open',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_key_key" ON "products"("key");

-- CreateIndex
CREATE INDEX "products_category_country_idx" ON "products"("category", "country");

-- CreateIndex
CREATE INDEX "supplier_products_product_id_idx" ON "supplier_products"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_products_supplier_code_sku_key" ON "supplier_products"("supplier_code", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_rules_category_country_code_product_id_key" ON "pricing_rules"("category", "country_code", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "reseller_markups_reseller_id_category_product_id_key" ON "reseller_markups"("reseller_id", "category", "product_id");

-- CreateIndex
CREATE INDEX "quotes_reseller_id_created_at_idx" ON "quotes"("reseller_id", "created_at");

-- AddForeignKey
ALTER TABLE "supplier_markets" ADD CONSTRAINT "supplier_markets_supplier_code_fkey" FOREIGN KEY ("supplier_code") REFERENCES "suppliers"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_code_fkey" FOREIGN KEY ("supplier_code") REFERENCES "suppliers"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_markups" ADD CONSTRAINT "reseller_markups_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules with an empty scope (all categories, all markets, any product) are still unique.
DROP INDEX "pricing_rules_category_country_code_product_id_key";
CREATE UNIQUE INDEX "pricing_rules_category_country_code_product_id_key" ON "pricing_rules"("category", "country_code", "product_id") NULLS NOT DISTINCT;
DROP INDEX "reseller_markups_reseller_id_category_product_id_key";
CREATE UNIQUE INDEX "reseller_markups_reseller_id_category_product_id_key" ON "reseller_markups"("reseller_id", "category", "product_id") NULLS NOT DISTINCT;

ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_bps_check" CHECK ("margin_bps" BETWEEN 0 AND 5000 AND "reseller_discount_bps" BETWEEN 0 AND 3000);
ALTER TABLE "reseller_markups" ADD CONSTRAINT "reseller_markups_bps_check" CHECK ("markup_bps" BETWEEN 0 AND 10000);
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_cost_check" CHECK ("cost_ratio" > 0 AND "cost_fee_minor" >= 0 AND "discount_bps" BETWEEN 0 AND 5000);
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_amounts_check" CHECK ("quantity" > 0 AND "face_value_minor" > 0 AND "wholesale_minor" > 0 AND "price_minor" >= "wholesale_minor" + "tax_minor");

-- BitoCard default pricing: 3% margin on supplier cost for cost-priced products; no reseller discount until admins set one.
INSERT INTO "pricing_rules" ("id", "category", "country_code", "product_id", "margin_bps", "reseller_discount_bps", "updated_at")
VALUES (gen_random_uuid(), NULL, NULL, NULL, 300, 0, now());

-- The supplier registry (PLANS.md section 4). Only the MVP live suppliers start enabled.
INSERT INTO "suppliers" ("code", "name", "categories", "coverage", "status", "enabled", "updated_at") VALUES
  ('reloadly', 'Reloadly', ARRAY['gift_cards', 'airtime', 'data', 'bills', 'pay_tv']::"ProductCategory"[], 'Global; Kenya electricity and TV to confirm', 'mvp_live', true, now()),
  ('prestmit', 'Prestmit', ARRAY['gift_cards']::"ProductCategory"[], 'To confirm', 'later', false, now()),
  ('cardtonic', 'Cardtonic', ARRAY['gift_cards']::"ProductCategory"[], 'To confirm', 'later', false, now()),
  ('vtpass', 'VTpass', ARRAY['pay_tv', 'bills']::"ProductCategory"[], 'Nigeria', 'mvp_live', true, now()),
  ('quickteller', 'Interswitch / Quickteller', ARRAY['pay_tv', 'bills']::"ProductCategory"[], 'Nigeria', 'mvp_qualify', false, now()),
  ('korba', 'Korba Xchange', ARRAY['pay_tv', 'bills']::"ProductCategory"[], 'Ghana', 'mvp_qualify', false, now()),
  ('hubtel', 'Hubtel', ARRAY['pay_tv', 'bills']::"ProductCategory"[], 'Ghana', 'mvp_qualify', false, now()),
  ('techlink_gh', 'Techlink GH', ARRAY['pay_tv', 'bills']::"ProductCategory"[], 'Ghana', 'backup', false, now()),
  ('kingflexy_gh', 'KiNG FLEXY GH', ARRAY['pay_tv', 'bills']::"ProductCategory"[], 'Ghana', 'backup', false, now()),
  ('ipay_elipa', 'iPay Africa / eLipa', ARRAY['pay_tv', 'bills']::"ProductCategory"[], 'Kenya', 'mvp_qualify', false, now()),
  ('tupay', 'Tupay', ARRAY['pay_tv']::"ProductCategory"[], 'Kenya', 'backup', false, now()),
  ('cellulant', 'Cellulant / Tingg', ARRAY['pay_tv', 'bills']::"ProductCategory"[], 'Pan-African', 'later', false, now()),
  ('esim_access', 'eSIM Access', ARRAY['esim']::"ProductCategory"[], 'Global', 'pilot', false, now()),
  ('esimerge', 'eSimerge', ARRAY['esim']::"ProductCategory"[], 'Global', 'pilot', false, now()),
  ('airalo', 'Airalo Partners', ARRAY['esim']::"ProductCategory"[], 'Global', 'backup', false, now()),
  ('esim_go', 'eSIM Go', ARRAY['esim']::"ProductCategory"[], 'Global', 'backup', false, now()),
  ('nexway', 'Nexway Connect', ARRAY['software']::"ProductCategory"[], 'To confirm', 'pilot', false, now()),
  ('ingram_micro', 'Ingram Micro', ARRAY['software']::"ProductCategory"[], 'To confirm', 'later', false, now()),
  ('td_synnex', 'TD SYNNEX', ARRAY['software']::"ProductCategory"[], 'To confirm', 'later', false, now()),
  ('pax8', 'Pax8', ARRAY['software']::"ProductCategory"[], 'To confirm', 'later', false, now()),
  ('also', 'ALSO Cloud Marketplace', ARRAY['software']::"ProductCategory"[], 'Mainly Europe', 'later', false, now()),
  ('didww', 'DIDWW', ARRAY['virtual_numbers']::"ProductCategory"[], '90+ countries', 'later', false, now()),
  ('telnyx', 'Telnyx', ARRAY['virtual_numbers']::"ProductCategory"[], 'Global', 'later', false, now()),
  ('vonage', 'Vonage', ARRAY['virtual_numbers']::"ProductCategory"[], 'Global', 'later', false, now()),
  ('twilio', 'Twilio', ARRAY['virtual_numbers']::"ProductCategory"[], 'Global', 'later', false, now()),
  ('plivo', 'Plivo', ARRAY['virtual_numbers']::"ProductCategory"[], 'Global', 'later', false, now()),
  ('africas_talking', 'Africa''s Talking', ARRAY['virtual_numbers']::"ProductCategory"[], 'Africa', 'later', false, now()),
  ('flutterwave_cards', 'Flutterwave (cards)', ARRAY['virtual_cards']::"ProductCategory"[], 'Nigeria pilot', 'later', false, now()),
  ('maplerad', 'Maplerad', ARRAY['virtual_cards']::"ProductCategory"[], 'Nigeria', 'later', false, now()),
  ('onafriq', 'Onafriq', ARRAY['virtual_cards']::"ProductCategory"[], 'Pan-African', 'later', false, now());

-- Where the MVP suppliers are used: Reloadly for gift cards, airtime and data in every pilot market; VTpass for Nigerian pay-TV and bills.
INSERT INTO "supplier_markets" ("supplier_code", "country_code", "category", "enabled")
SELECT 'reloadly', c.code, cat.category::"ProductCategory", true
FROM (VALUES ('NG'), ('GH'), ('KE')) AS c(code), (VALUES ('gift_cards'), ('airtime'), ('data')) AS cat(category);
INSERT INTO "supplier_markets" ("supplier_code", "country_code", "category", "enabled") VALUES
  ('vtpass', 'NG', 'pay_tv', true),
  ('vtpass', 'NG', 'bills', true);
