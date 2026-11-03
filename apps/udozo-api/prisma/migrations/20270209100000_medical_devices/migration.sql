-- Medical equipment (3 November 2026, the owner's request): a subcategory of Hospital and medical equipment for the
-- everyday instruments that fit none of the others (stethoscopes, blood pressure sets, diagnostic sets, otoscopes and
-- ophthalmoscopes, examination lamps), first in its list, with its features, brands and models; and the logos Simple
-- Icons (CC0) has for the medical brands added earlier: GE HealthCare (GE's monogram), Abbott and 3M, bundled with
-- udozo.com (apps/udozo/public/brand-logos). The other new brands show their initials until an admin uploads a logo.

-- A free three-letter prefix: the first of the wished ones no category has had, else the first free one.
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

-- First in Hospital and medical equipment: the others move down one.
UPDATE "classified_categories" SET "position" = "position" + 1, "updated_at" = CURRENT_TIMESTAMP
WHERE "parent_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'medical-equipment') AND "slug" <> 'medical-devices';

INSERT INTO "classified_categories" ("id", "parent_id", "slug", "name", "icon", "position", "enabled", "sku_prefix", "updated_at")
SELECT gen_random_uuid(), p."id", 'medical-devices', 'Medical equipment', 'briefcase-medical', 0, true, pg_temp.udz_free_prefix(ARRAY['MDV', 'MEQ', 'MDI']), CURRENT_TIMESTAMP
FROM "classified_categories" p WHERE p."slug" = 'medical-equipment'
ON CONFLICT ("slug") DO UPDATE SET "parent_id" = EXCLUDED."parent_id", "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "position" = 0, "enabled" = true, "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "classified_category_sku_prefixes" ("prefix", "category_id")
SELECT "sku_prefix", "id" FROM "classified_categories" WHERE "slug" = 'medical-devices'
ON CONFLICT ("prefix") DO NOTHING;
DROP FUNCTION pg_temp.udz_free_prefix(TEXT[]);

-- Open wherever its parent is, as it is there.
INSERT INTO "classified_category_countries" ("category_id", "country", "enabled")
SELECT c."id", pc."country", pc."enabled"
FROM "classified_category_countries" pc
JOIN "classified_categories" p ON p."id" = pc."category_id" AND p."slug" = 'medical-equipment'
CROSS JOIN "classified_categories" c
WHERE c."slug" = 'medical-devices'
ON CONFLICT ("category_id", "country") DO NOTHING;

INSERT INTO "classified_category_features" ("category_id", "feature_id", "position", "filter", "placeholder")
SELECT c."id", f."id", v."position", v."filter" AND f."filterable", v."placeholder" FROM (VALUES
  ('brand', 0, true, NULL),
  ('model', 1, false, NULL),
  ('power_source', 2, true, NULL),
  ('certification', 3, true, NULL),
  ('registration_number', 4, false, NULL),
  ('warranty', 5, false, NULL),
  ('included', 6, false, NULL)
) AS v("key", "position", "filter", "placeholder") JOIN "classified_categories" c ON c."slug" = 'medical-devices' JOIN "classified_features" f ON f."key" = v."key"
ON CONFLICT DO NOTHING;

-- Brands this subcategory needs that the registry lacked.
INSERT INTO "classified_brands" ("id", "slug", "name", "name_key", "aliases", "match_keys", "logo_file", "color", "updated_at") VALUES
  (gen_random_uuid(), 'littmann', 'Littmann', 'littmann', ARRAY['3m littmann']::TEXT[], ARRAY['littmann', '3mlittmann']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'heine', 'Heine', 'heine', ARRAY[]::TEXT[], ARRAY['heine']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'adc', 'ADC', 'adc', ARRAY['american diagnostic']::TEXT[], ARRAY['adc', 'americandiagnostic']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'mdf-instruments', 'MDF Instruments', 'mdfinstruments', ARRAY['mdf']::TEXT[], ARRAY['mdfinstruments', 'mdf']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'spengler', 'Spengler', 'spengler', ARRAY[]::TEXT[], ARRAY['spengler']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Its brands, most bought first (existing brands linked, never made twice).
INSERT INTO "classified_brand_categories" ("brand_id", "category_id", "position")
SELECT b."id", c."id", v."position" FROM (VALUES
  ('littmann', 0),
  ('welchallyn', 1),
  ('riester', 2),
  ('omron', 3),
  ('heine', 4),
  ('contec', 5),
  ('yuwell', 6),
  ('adc', 7),
  ('mdfinstruments', 8),
  ('spengler', 9),
  ('mindray', 10),
  ('medline', 11)
) AS v("brand", "position")
JOIN "classified_brands" b ON b."name_key" = v."brand"
JOIN "classified_categories" c ON c."slug" = 'medical-devices'
ON CONFLICT DO NOTHING;

-- Their models, each brand's best known first.
INSERT INTO "classified_brand_models" ("id", "brand_id", "category_id", "name", "name_key", "aliases", "match_keys", "position", "updated_at")
SELECT gen_random_uuid(), b."id", c."id", v."name", v."name_key", v."aliases", v."match_keys", v."position", CURRENT_TIMESTAMP FROM (VALUES
  ('littmann', 'Classic III', 'classiciii', ARRAY[]::TEXT[], ARRAY['classiciii']::TEXT[], 0),
  ('littmann', 'Cardiology IV', 'cardiologyiv', ARRAY[]::TEXT[], ARRAY['cardiologyiv']::TEXT[], 1),
  ('littmann', 'Lightweight II S.E.', 'lightweightiise', ARRAY['lightweight']::TEXT[], ARRAY['lightweightiise', 'lightweight']::TEXT[], 2),
  ('littmann', 'Core Digital', 'coredigital', ARRAY[]::TEXT[], ARRAY['coredigital']::TEXT[], 3),
  ('littmann', 'Master Cardiology', 'mastercardiology', ARRAY[]::TEXT[], ARRAY['mastercardiology']::TEXT[], 4),
  ('welchallyn', 'DuraShock DS44', 'durashockds44', ARRAY['ds44']::TEXT[], ARRAY['durashockds44', 'ds44']::TEXT[], 0),
  ('welchallyn', 'PocketScope', 'pocketscope', ARRAY[]::TEXT[], ARRAY['pocketscope']::TEXT[], 1),
  ('welchallyn', 'MacroView', 'macroview', ARRAY[]::TEXT[], ARRAY['macroview']::TEXT[], 2),
  ('riester', 'e-scope', 'escope', ARRAY[]::TEXT[], ARRAY['escope']::TEXT[], 0),
  ('riester', 'ri-san', 'risan', ARRAY[]::TEXT[], ARRAY['risan']::TEXT[], 1),
  ('riester', 'Duplex 2.0', 'duplex20', ARRAY[]::TEXT[], ARRAY['duplex20']::TEXT[], 2),
  ('riester', 'big ben', 'bigben', ARRAY[]::TEXT[], ARRAY['bigben']::TEXT[], 3),
  ('heine', 'Beta 200', 'beta200', ARRAY[]::TEXT[], ARRAY['beta200']::TEXT[], 0),
  ('heine', 'Mini 3000', 'mini3000', ARRAY[]::TEXT[], ARRAY['mini3000']::TEXT[], 1),
  ('heine', 'Gamma G5', 'gammag5', ARRAY[]::TEXT[], ARRAY['gammag5']::TEXT[], 2),
  ('adc', 'Adscope 603', 'adscope603', ARRAY[]::TEXT[], ARRAY['adscope603']::TEXT[], 0),
  ('adc', 'Diagnostix 700', 'diagnostix700', ARRAY[]::TEXT[], ARRAY['diagnostix700']::TEXT[], 1),
  ('mdfinstruments', 'ProCardial', 'procardial', ARRAY[]::TEXT[], ARRAY['procardial']::TEXT[], 0),
  ('mdfinstruments', 'Acoustica', 'acoustica', ARRAY[]::TEXT[], ARRAY['acoustica']::TEXT[], 1),
  ('spengler', 'Lian Classic', 'lianclassic', ARRAY[]::TEXT[], ARRAY['lianclassic']::TEXT[], 0),
  ('spengler', 'Pulsonic', 'pulsonic', ARRAY[]::TEXT[], ARRAY['pulsonic']::TEXT[], 1),
  ('omron', 'HBP-1320', 'hbp1320', ARRAY[]::TEXT[], ARRAY['hbp1320']::TEXT[], 0),
  ('omron', 'HBP-1120', 'hbp1120', ARRAY[]::TEXT[], ARRAY['hbp1120']::TEXT[], 1),
  ('contec', 'CMS50D', 'cms50d', ARRAY[]::TEXT[], ARRAY['cms50d']::TEXT[], 0),
  ('contec', 'ECG300G', 'ecg300g', ARRAY[]::TEXT[], ARRAY['ecg300g']::TEXT[], 1),
  ('yuwell', '7E-A', '7ea', ARRAY[]::TEXT[], ARRAY['7ea']::TEXT[], 0)
) AS v("brand", "name", "name_key", "aliases", "match_keys", "position")
JOIN "classified_brands" b ON b."name_key" = v."brand"
JOIN "classified_categories" c ON c."slug" = 'medical-devices'
ON CONFLICT DO NOTHING;

-- Logos bundled with udozo.com for three of the medical brands (Simple Icons, CC0), in their brands' colours.
UPDATE "classified_brands" AS b SET "logo_file" = v."file", "color" = v."color", "updated_at" = CURRENT_TIMESTAMP FROM (VALUES
  ('ge-healthcare', 'ge-healthcare', '#0870D8'),
  ('abbott', 'abbott', '#008FC7'),
  ('3m', '3m', '#FF0000')
) AS v("slug", "file", "color") WHERE b."slug" = v."slug" AND b."logo_file" IS NULL;
