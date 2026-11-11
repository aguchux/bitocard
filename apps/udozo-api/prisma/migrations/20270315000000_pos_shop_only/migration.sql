-- Udozo POS (docs/UDOZO_POS_PLAN.md, 11 November 2026, the owner's request): a shop sells at its till what Udozo's public
-- market does not take. Shop-only categories are offered only to listings sold at the seller's shop through Udozo POS
-- (on neither Udozo nor resellers), and are never opened in a market: no `classified_category_countries` row, so every
-- public reader (pages, search, menus, sitemaps, the assistants) leaves them out. The first are a pharmacy's: what the
-- market refuses or reviews (prescription medicines, antibiotics among them) and what a chemist sells beside them. The
-- shop selling them answers for its licences (the POS terms say so).
--
-- And each POS shop has a kind (a pharmacy, an auto parts shop…), so the till can be tailored to it: its categories
-- first now, a theme of its own later.

ALTER TABLE "classified_categories" ADD COLUMN "shop_only" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pos_shops" ADD COLUMN "kind" VARCHAR(32) NOT NULL DEFAULT 'general';

-- A listing past draft is complete: a public one with its area and condition, a shop-only one (never public) with what
-- the till needs, its title, category and price.
ALTER TABLE "classified_listings" DROP CONSTRAINT "classified_listings_complete_check";
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_complete_check" CHECK (
  "status" = 'draft'
  OR ("category_id" IS NOT NULL AND "area_id" IS NOT NULL AND "state_id" IS NOT NULL AND "title" IS NOT NULL AND "condition" IS NOT NULL AND ("price_kind" = 'on_request' OR "price_minor" IS NOT NULL))
  OR (NOT "on_shop" AND NOT "resale" AND "pos_enabled_at" IS NOT NULL AND "category_id" IS NOT NULL AND "title" IS NOT NULL AND "price_minor" IS NOT NULL)
);

CREATE OR REPLACE FUNCTION pg_temp.udz_free_prefix(wished TEXT[]) RETURNS CHAR(3) AS $$
DECLARE
  candidate TEXT;
BEGIN
  FOREACH candidate IN ARRAY wished LOOP
    IF NOT EXISTS (SELECT 1 FROM "classified_category_sku_prefixes" WHERE "prefix" = candidate) AND NOT EXISTS (SELECT 1 FROM "classified_categories" WHERE "sku_prefix" = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;
  SELECT p INTO candidate FROM (
    SELECT chr(a) || chr(b) || chr(c) AS p FROM generate_series(77, 90) a, generate_series(65, 90) b, generate_series(65, 90) c
  ) AS every
  WHERE NOT EXISTS (SELECT 1 FROM "classified_category_sku_prefixes" WHERE "prefix" = every.p) AND NOT EXISTS (SELECT 1 FROM "classified_categories" WHERE "sku_prefix" = every.p)
  ORDER BY p LIMIT 1;
  RETURN candidate;
END;
$$ LANGUAGE plpgsql;

-- The top category, last in the list (it shows only in Post an ad, for sellers with Udozo POS).
INSERT INTO "classified_categories" ("id", "parent_id", "slug", "name", "icon", "position", "enabled", "shop_only", "sku_prefix", "keywords", "updated_at")
SELECT gen_random_uuid(), NULL, 'pharmacy', 'Pharmacy and medicines', 'pill', COALESCE((SELECT MAX("position") + 1 FROM "classified_categories" WHERE "parent_id" IS NULL), 0), true, true,
  pg_temp.udz_free_prefix(ARRAY['PHA', 'PHM', 'DRG']), ARRAY['pharmacy', 'chemist', 'drugstore', 'medicine', 'drugs']::TEXT[], CURRENT_TIMESTAMP
ON CONFLICT ("slug") DO UPDATE SET "shop_only" = true, "enabled" = true, "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "classified_categories" ("id", "parent_id", "slug", "name", "icon", "position", "enabled", "shop_only", "sku_prefix", "keywords", "updated_at")
SELECT gen_random_uuid(), p."id", 'prescription-medicines', 'Prescription medicines', 'pill', 0, true, true, pg_temp.udz_free_prefix(ARRAY['RXM', 'PRX', 'POM']),
  ARRAY['prescription', 'antibiotic', 'antibiotics', 'amoxicillin', 'augmentin', 'ciprofloxacin', 'metronidazole', 'antimalarial', 'artemether', 'coartem', 'antihypertensive', 'amlodipine', 'insulin', 'metformin', 'inhaler']::TEXT[], CURRENT_TIMESTAMP
FROM "classified_categories" p WHERE p."slug" = 'pharmacy'
ON CONFLICT ("slug") DO UPDATE SET "parent_id" = EXCLUDED."parent_id", "shop_only" = true, "enabled" = true, "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "classified_categories" ("id", "parent_id", "slug", "name", "icon", "position", "enabled", "shop_only", "sku_prefix", "keywords", "updated_at")
SELECT gen_random_uuid(), p."id", 'otc-medicines', 'Over-the-counter medicines', 'tablets', 1, true, true, pg_temp.udz_free_prefix(ARRAY['OTC', 'OTM']),
  ARRAY['paracetamol', 'panadol', 'ibuprofen', 'cough syrup', 'antacid', 'oral rehydration', 'ors', 'pain relief', 'cold and flu', 'eye drops', 'antiseptic', 'dewormer']::TEXT[], CURRENT_TIMESTAMP
FROM "classified_categories" p WHERE p."slug" = 'pharmacy'
ON CONFLICT ("slug") DO UPDATE SET "parent_id" = EXCLUDED."parent_id", "shop_only" = true, "enabled" = true, "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "classified_categories" ("id", "parent_id", "slug", "name", "icon", "position", "enabled", "shop_only", "sku_prefix", "keywords", "updated_at")
SELECT gen_random_uuid(), p."id", 'herbal-medicines', 'Herbal medicines', 'leaf', 2, true, true, pg_temp.udz_free_prefix(ARRAY['HRB', 'HBM']),
  ARRAY['herbal', 'herbs', 'bitters', 'agbo', 'traditional medicine', 'tea']::TEXT[], CURRENT_TIMESTAMP
FROM "classified_categories" p WHERE p."slug" = 'pharmacy'
ON CONFLICT ("slug") DO UPDATE SET "parent_id" = EXCLUDED."parent_id", "shop_only" = true, "enabled" = true, "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "classified_categories" ("id", "parent_id", "slug", "name", "icon", "position", "enabled", "shop_only", "sku_prefix", "keywords", "updated_at")
SELECT gen_random_uuid(), p."id", 'vitamins-supplements', 'Vitamins and supplements', 'heart-pulse', 3, true, true, pg_temp.udz_free_prefix(ARRAY['VIT', 'SUP']),
  ARRAY['vitamin', 'vitamins', 'supplement', 'supplements', 'multivitamin', 'vitamin c', 'zinc', 'omega 3', 'iron', 'folic acid', 'protein']::TEXT[], CURRENT_TIMESTAMP
FROM "classified_categories" p WHERE p."slug" = 'pharmacy'
ON CONFLICT ("slug") DO UPDATE SET "parent_id" = EXCLUDED."parent_id", "shop_only" = true, "enabled" = true, "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "classified_category_sku_prefixes" ("prefix", "category_id")
SELECT "sku_prefix", "id" FROM "classified_categories" WHERE "slug" IN ('pharmacy', 'prescription-medicines', 'otc-medicines', 'herbal-medicines', 'vitamins-supplements')
ON CONFLICT ("prefix") DO NOTHING;

-- What a chemist records about each: the brand, the pack, its registration number and expiry, and that it is sealed.
INSERT INTO "classified_category_features" ("category_id", "feature_id", "position", "filter", "placeholder")
SELECT c."id", f."id", v."position", false, NULL FROM (VALUES
  ('brand', 0),
  ('pack_size', 1),
  ('registration_number', 2),
  ('expiry', 3),
  ('sealed', 4)
) AS v("key", "position")
CROSS JOIN "classified_categories" c
JOIN "classified_features" f ON f."key" = v."key"
WHERE c."slug" IN ('prescription-medicines', 'otc-medicines', 'herbal-medicines', 'vitamins-supplements')
ON CONFLICT DO NOTHING;

DROP FUNCTION pg_temp.udz_free_prefix(TEXT[]);
