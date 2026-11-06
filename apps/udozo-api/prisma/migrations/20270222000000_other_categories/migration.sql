-- Somewhere for what fits no category (6 November 2026, the owner's request): Other services, last under Services, as
-- Jiji has it (house sitting, weeding, ushering, borehole drilling…), and for goods a last top category, Everything
-- else, with Other items. Post an ad offers both when a search finds no category; their search words say what people
-- call such things. Open wherever Services is.

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

-- Everything else: the last top category, with the general checks for meeting and paying.
INSERT INTO "classified_categories" ("id", "slug", "name", "icon", "position", "enabled", "sku_prefix", "safety_checklist", "keywords", "updated_at")
SELECT gen_random_uuid(), 'everything-else', 'Everything else', 'shapes', (SELECT COALESCE(MAX("position"), 0) + 1 FROM "classified_categories" WHERE "parent_id" IS NULL), true, pg_temp.udz_free_prefix(ARRAY['EVE', 'ELS', 'MSC']),
  ARRAY['Meet in a busy public place in daylight, and tell someone where you are going', 'Inspect it and test it before you pay', 'Pay only when you are satisfied, and confirm a transfer in your own banking app before handing over'], ARRAY[]::TEXT[], CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "classified_categories" WHERE "slug" = 'everything-else');

INSERT INTO "classified_categories" ("id", "parent_id", "slug", "name", "icon", "position", "b2b", "enabled", "sku_prefix", "keywords", "updated_at")
SELECT gen_random_uuid(), p."id", 'other-items', 'Other items', 'package', 0, false, true, pg_temp.udz_free_prefix(ARRAY['OTH', 'OIT', 'MIS']),
  ARRAY['other', 'others', 'other items', 'miscellaneous', 'general', 'general goods', 'assorted', 'mixed items', 'anything', 'everything', 'antique', 'collectible', 'souvenir', 'gift item', 'custom made', 'handmade', 'second hand item', 'used item', 'unusual']::TEXT[], CURRENT_TIMESTAMP
FROM "classified_categories" p WHERE p."slug" = 'everything-else'
ON CONFLICT ("slug") DO NOTHING;

-- Other services: last under Services.
INSERT INTO "classified_categories" ("id", "parent_id", "slug", "name", "icon", "position", "b2b", "enabled", "sku_prefix", "keywords", "updated_at")
SELECT gen_random_uuid(), p."id", 'other-services', 'Other services', 'hand-helping', (SELECT COALESCE(MAX(c."position"), 0) + 1 FROM "classified_categories" c WHERE c."parent_id" = p."id"), p."b2b", true, pg_temp.udz_free_prefix(ARRAY['OTS', 'OSV', 'MSV']),
  ARRAY['other services', 'other service', 'service', 'general services', 'house sitting', 'house help', 'housekeeper', 'steward', 'nanny', 'cook', 'gardener', 'gardening', 'weeding', 'lawn mowing', 'borehole drilling', 'usher', 'ushering', 'security guard', 'errand', 'personal assistant', 'tour guide', 'translator', 'interpreter', 'recruitment', 'counselling', 'fitness trainer', 'massage', 'pet sitting', 'dog walking']::TEXT[], CURRENT_TIMESTAMP
FROM "classified_categories" p WHERE p."slug" = 'services'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "classified_category_sku_prefixes" ("prefix", "category_id")
SELECT "sku_prefix", "id" FROM "classified_categories" WHERE "slug" IN ('everything-else', 'other-items', 'other-services')
ON CONFLICT ("prefix") DO NOTHING;
DROP FUNCTION pg_temp.udz_free_prefix(TEXT[]);

-- Open wherever Services is, as it is there.
INSERT INTO "classified_category_countries" ("category_id", "country", "enabled")
SELECT c."id", pc."country", pc."enabled"
FROM "classified_category_countries" pc
JOIN "classified_categories" s ON s."id" = pc."category_id" AND s."slug" = 'services'
CROSS JOIN "classified_categories" c
WHERE c."slug" IN ('everything-else', 'other-items', 'other-services')
ON CONFLICT ("category_id", "country") DO NOTHING;

INSERT INTO "classified_category_features" ("category_id", "feature_id", "position", "filter", "placeholder")
SELECT c."id", f."id", v."position", v."filter" AND f."filterable", v."placeholder" FROM (VALUES
  ('other-items', 'type', 0, false, 'Say what it is, e.g. a wooden carving, a church bell, a shop sign'),
  ('other-items', 'material', 1, false, NULL),
  ('other-items', 'colour', 2, true, NULL),
  ('other-items', 'size', 3, false, NULL),
  ('other-items', 'dimensions', 4, false, NULL),
  ('other-items', 'quantity_available', 5, false, NULL),
  ('other-services', 'type', 0, false, 'Say what you do, e.g. house sitting, ushering, borehole drilling'),
  ('other-services', 'pricing', 1, true, NULL),
  ('other-services', 'home_service', 2, true, NULL),
  ('other-services', 'experience', 3, true, NULL),
  ('other-services', 'certified', 4, true, NULL),
  ('other-services', 'availability', 5, false, NULL),
  ('other-services', 'team_size', 6, false, NULL),
  ('other-services', 'emergency', 7, true, NULL)
) AS v("slug", "key", "position", "filter", "placeholder")
JOIN "classified_categories" c ON c."slug" = v."slug"
JOIN "classified_features" f ON f."key" = v."key"
ON CONFLICT DO NOTHING;
