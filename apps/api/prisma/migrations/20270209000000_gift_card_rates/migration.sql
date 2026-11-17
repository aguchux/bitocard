-- Gift cards are sold by rate: the card shows its face value, and its price is the face value at BitoCard's rate
-- (what the supplier charges, converted, plus BitoCard's markup), then the reseller's markup on top. Their rules are
-- always a markup, so older discount, fixed or automatic rules for gift cards become markups, and every market
-- starts at 10% where no rule for gift cards exists yet.
UPDATE "pricing_rules"
SET "kind" = 'markup', "fixed_minor" = NULL, "fixed_currency" = NULL, "reseller_discount_bps" = 0,
    "margin_bps" = CASE WHEN "kind" = 'markup' THEN "margin_bps" ELSE GREATEST("margin_bps", 1000) END
WHERE "category" = 'gift_cards'
   OR "product_id" IN (SELECT "id" FROM "products" WHERE "category" = 'gift_cards');

INSERT INTO "pricing_rules" ("id", "category", "country_code", "supplier_code", "product_id", "kind", "margin_bps", "reseller_discount_bps", "updated_at")
SELECT gen_random_uuid(), 'gift_cards', NULL, NULL, NULL, 'markup', 1000, 0, now()
WHERE NOT EXISTS (
  SELECT 1 FROM "pricing_rules" WHERE "category" = 'gift_cards' AND "country_code" IS NULL AND "supplier_code" IS NULL AND "product_id" IS NULL
);

-- Resellers' fixed prices on gift cards no longer apply (they set a markup on BitoCard's rate).
UPDATE "reseller_markups" SET "fixed_minor" = NULL
WHERE "product_id" IN (SELECT "id" FROM "products" WHERE "category" = 'gift_cards') AND "fixed_minor" IS NOT NULL;
