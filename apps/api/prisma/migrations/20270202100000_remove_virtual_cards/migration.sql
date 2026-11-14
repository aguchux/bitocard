-- Virtual payment cards are gone from BitoCard for good (the owner's decision, 14 November 2026): the category, its
-- suppliers (Flutterwave cards, Maplerad, Onafriq) and their settings, and anything that names it. No virtual card adapter
-- was ever built, so nothing was ever sold; if an order, quote or fee somehow names one, this stops rather than delete
-- money records.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "orders" o JOIN "products" p ON p."id" = o."product_id" WHERE p."category"::text = 'virtual_cards')
     OR EXISTS (SELECT 1 FROM "quotes" q JOIN "products" p ON p."id" = q."product_id" WHERE p."category"::text = 'virtual_cards')
     OR EXISTS (SELECT 1 FROM "fee_charges" WHERE "category"::text = 'virtual_cards') THEN
    RAISE EXCEPTION 'Virtual card orders, quotes or fees exist: remove them by hand before this migration';
  END IF;
END $$;

DELETE FROM "pricing_rules" WHERE "category"::text = 'virtual_cards' OR "supplier_code" IN ('flutterwave_cards', 'maplerad', 'onafriq')
  OR "product_id" IN (SELECT "id" FROM "products" WHERE "category"::text = 'virtual_cards');
DELETE FROM "reseller_markups" WHERE "category"::text = 'virtual_cards' OR "product_id" IN (SELECT "id" FROM "products" WHERE "category"::text = 'virtual_cards');
DELETE FROM "fee_rules" WHERE "category"::text = 'virtual_cards';
UPDATE "stores" SET "focus" = NULL WHERE "focus" LIKE 'virtual\_cards:%';
DELETE FROM "supplier_products" WHERE "supplier_code" IN ('flutterwave_cards', 'maplerad', 'onafriq')
  OR "product_id" IN (SELECT "id" FROM "products" WHERE "category"::text = 'virtual_cards');
DELETE FROM "products" WHERE "category"::text = 'virtual_cards';
DELETE FROM "country_categories" WHERE "category"::text = 'virtual_cards';
DELETE FROM "category_presentations" WHERE "category"::text = 'virtual_cards';
DELETE FROM "supplier_markets" WHERE "category"::text = 'virtual_cards' OR "supplier_code" IN ('flutterwave_cards', 'maplerad', 'onafriq');
DELETE FROM "suppliers" WHERE "code" IN ('flutterwave_cards', 'maplerad', 'onafriq');
UPDATE "suppliers" SET "categories" = array_remove("categories", 'virtual_cards') WHERE 'virtual_cards' = ANY ("categories");
DELETE FROM "reseller_connections" WHERE "integration_id" IN ('maplerad', 'onafriq');
DELETE FROM "integration_offers" WHERE "integration_id" IN ('maplerad', 'onafriq');
DELETE FROM "integration_settings" WHERE "key" ~ '^(MAPLERAD|ONAFRIQ)_';

-- Home pages: the category, its products and links to it taken out; everything else kept.
CREATE FUNCTION pg_temp.rm_cards(j JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $f$
BEGIN
  IF j IS NULL THEN
    RETURN NULL;
  ELSIF jsonb_typeof(j) = 'array' THEN
    RETURN COALESCE((
      SELECT jsonb_agg(pg_temp.rm_cards(e) ORDER BY i)
      FROM jsonb_array_elements(j) WITH ORDINALITY AS t(e, i)
      WHERE NOT COALESCE(jsonb_typeof(e) = 'string' AND (e #>> '{}' = 'virtual_cards' OR e #>> '{}' LIKE 'virtual\_cards:%'), false)
        AND NOT COALESCE(jsonb_typeof(e) = 'object' AND e -> 'cta' ->> 'href' ~ '^/catalogs/(virtual_cards|virtual-cards)(\?|/|$)', false)
    ), '[]'::jsonb);
  ELSIF jsonb_typeof(j) = 'object' THEN
    RETURN COALESCE((
      SELECT jsonb_object_agg(k, CASE WHEN k = 'source' AND v #>> '{}' = 'category' AND j ->> 'category' = 'virtual_cards' THEN '"new"'::jsonb ELSE pg_temp.rm_cards(v) END)
      FROM jsonb_each(j) AS t(k, v)
      WHERE NOT COALESCE(k = 'category' AND v #>> '{}' = 'virtual_cards', false)
    ), '{}'::jsonb);
  END IF;
  RETURN j;
END $f$;

UPDATE "storefront_pages" SET "draft" = pg_temp.rm_cards("draft"::jsonb), "published" = pg_temp.rm_cards("published"::jsonb);
UPDATE "storefront_page_versions" SET "sections" = pg_temp.rm_cards("sections"::jsonb);
UPDATE "stores" SET "home_draft" = pg_temp.rm_cards("home_draft"::jsonb), "home_published" = pg_temp.rm_cards("home_published"::jsonb) WHERE "home_draft" IS NOT NULL OR "home_published" IS NOT NULL;
UPDATE "store_home_versions" SET "sections" = pg_temp.rm_cards("sections"::jsonb);

-- The category leaves the enum (in its database order, less it).
ALTER TYPE "ProductCategory" RENAME TO "ProductCategory_old";
CREATE TYPE "ProductCategory" AS ENUM ('gift_cards', 'airtime', 'data', 'bills', 'pay_tv', 'software', 'mobile_money', 'vpn', 'rdp');
ALTER TABLE "country_categories" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "suppliers" ALTER COLUMN "categories" TYPE "ProductCategory"[] USING "categories"::text[]::"ProductCategory"[];
ALTER TABLE "supplier_markets" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "products" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "pricing_rules" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "reseller_markups" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "fee_rules" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "fee_charges" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "category_presentations" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
DROP TYPE "ProductCategory_old";
