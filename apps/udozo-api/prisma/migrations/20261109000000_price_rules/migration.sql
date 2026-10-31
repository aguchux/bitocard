-- Pricing: each offer sells under one scheme. Discount: the customer pays face value and the supplier's discount is
-- shared (BitoCard passes part to the reseller, who may pass part to customers). Markup: priced up from cost (BitoCard's
-- markup or fixed price, then the reseller's). `auto` (the default) is discount wherever the supplier gives one (cost
-- below face value) and markup otherwise, so nothing becomes unsellable. BitoCard's rules are scoped by country,
-- category, supplier and product (the most specific wins); the reseller's by category and product.

ALTER TABLE "pricing_rules" ADD COLUMN "supplier_code" TEXT;
ALTER TABLE "pricing_rules" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "pricing_rules" ADD COLUMN "fixed_minor" BIGINT;
ALTER TABLE "pricing_rules" ADD COLUMN "fixed_currency" CHAR(3);

-- Rules keep both their values and price automatically; a product's own margin (BitoCard's stock) stays a markup.
UPDATE "pricing_rules" SET "kind" = 'markup' WHERE "product_id" IS NOT NULL;

-- Products without a meaningful face value are priced from cost unless an admin decides otherwise.
INSERT INTO "pricing_rules" ("id", "category", "country_code", "product_id", "margin_bps", "reseller_discount_bps", "kind", "updated_at")
SELECT gen_random_uuid(), category::"ProductCategory", NULL, NULL,
       COALESCE((SELECT "margin_bps" FROM "pricing_rules" WHERE "category" IS NULL AND "country_code" IS NULL AND "product_id" IS NULL), 300),
       0, 'markup', now()
FROM (VALUES ('virtual_numbers'), ('mobile_money')) AS defaults(category)
WHERE NOT EXISTS (SELECT 1 FROM "pricing_rules" r WHERE r."category"::text = defaults.category AND r."country_code" IS NULL AND r."product_id" IS NULL);

ALTER TABLE "pricing_rules" DROP CONSTRAINT "pricing_rules_bps_check";
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_values_check" CHECK (
  "kind" IN ('auto', 'discount', 'markup', 'fixed')
  AND "margin_bps" BETWEEN 0 AND 20000
  AND "reseller_discount_bps" BETWEEN 0 AND 10000
  AND ("kind" <> 'fixed' OR ("fixed_minor" IS NOT NULL AND "fixed_minor" > 0 AND "fixed_currency" IS NOT NULL))
);
DROP INDEX "pricing_rules_category_country_code_product_id_key";
CREATE UNIQUE INDEX "pricing_rules_scope_key" ON "pricing_rules"("category", "country_code", "supplier_code", "product_id") NULLS NOT DISTINCT;

-- The reseller's own pricing: a general rule (no category), category rules and product rules. On discount products,
-- how much of their discount they give their customers; on markup products, their markup, or a fixed price per product.
ALTER TABLE "reseller_markups" ALTER COLUMN "category" DROP NOT NULL;
ALTER TABLE "reseller_markups" ALTER COLUMN "markup_bps" DROP NOT NULL;
ALTER TABLE "reseller_markups" ADD COLUMN "customer_discount_bps" INTEGER;
ALTER TABLE "reseller_markups" ADD COLUMN "fixed_minor" BIGINT;
ALTER TABLE "reseller_markups" DROP CONSTRAINT "reseller_markups_bps_check";
ALTER TABLE "reseller_markups" ADD CONSTRAINT "reseller_markups_values_check" CHECK (
  ("markup_bps" IS NULL OR "markup_bps" BETWEEN 0 AND 10000)
  AND ("customer_discount_bps" IS NULL OR "customer_discount_bps" BETWEEN 0 AND 10000)
  AND ("fixed_minor" IS NULL OR ("fixed_minor" > 0 AND "product_id" IS NOT NULL))
);

-- Resellers mark up at most 100% (admins can lower it per country); the old default was 50%.
UPDATE "countries" SET "markup_cap_percent" = 100 WHERE "markup_cap_percent" = 50;
ALTER TABLE "countries" ALTER COLUMN "markup_cap_percent" SET DEFAULT 100;

-- Reconciliation: what the supplier said it charged for an order, and whether that differs from what was expected.
ALTER TABLE "orders" ADD COLUMN "supplier_reported_cost_minor" BIGINT;
ALTER TABLE "orders" ADD COLUMN "cost_mismatch" BOOLEAN NOT NULL DEFAULT false;

-- Discount products always sell at face value at most: the "earn by a markup on top" option is gone.
DELETE FROM "reseller_options" WHERE "key" = 'fixed_price_earning';
DELETE FROM "country_options" WHERE "key" = 'fixed_price_earning';
