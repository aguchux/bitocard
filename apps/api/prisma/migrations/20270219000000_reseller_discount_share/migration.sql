-- Discount products (airtime, data, bills, pay-TV) split the supplier's discount between resellers and BitoCard as
-- admins set it (22 November 2026, the owner's decision): `reseller_share_bps` is the resellers' part out of 10,000,
-- half when no rule sets it, so every discount product can be listed. Older rules' fixed reseller discounts still
-- apply until a split is set.
ALTER TABLE "pricing_rules" ADD COLUMN "reseller_share_bps" INTEGER;
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_reseller_share_check" CHECK ("reseller_share_bps" IS NULL OR "reseller_share_bps" BETWEEN 0 AND 10000);

-- Markup products without a rule of their own earn BitoCard 10% (the owner's default), up from the 3% seeded.
UPDATE "pricing_rules" SET "margin_bps" = 1000, "updated_at" = now()
WHERE "category" IS NULL AND "country_code" IS NULL AND "supplier_code" IS NULL AND "product_id" IS NULL AND "margin_bps" = 300;
