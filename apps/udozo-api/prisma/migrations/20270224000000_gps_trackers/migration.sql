-- GPS trackers (6 November 2026, the owner's request): a subcategory of Electronics for vehicle, motorcycle, personal,
-- pet, livestock and asset trackers, with its features, the Safe Trade Guide's checks, search words and brands, among
-- them Cantrack (Huizhou Cantrack Technology Co., Ltd., cantrackgps.com), its mark bundled with udozo.com
-- (apps/udozo/public/brand-logos/cantrack.svg, from the brand's own site) and its models as its site lists them.

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

-- After CCTV and smart home, before routers.
UPDATE "classified_categories" SET "position" = "position" + 1, "updated_at" = CURRENT_TIMESTAMP
WHERE "parent_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'electronics')
  AND "position" > (SELECT "position" FROM "classified_categories" WHERE "slug" = 'security-surveillance');

INSERT INTO "classified_categories" ("id", "parent_id", "slug", "name", "icon", "position", "b2b", "enabled", "sku_prefix", "keywords", "safety_checklist", "updated_at")
SELECT gen_random_uuid(), p."id", 'gps-trackers', 'GPS trackers', 'locate-fixed', s."position" + 1, p."b2b", true, pg_temp.udz_free_prefix(ARRAY['GPS', 'TRK', 'GPT']),
  ARRAY['gps tracker', 'gps', 'tracker', 'car tracker', 'vehicle tracker', 'truck tracker', 'motorcycle tracker', 'okada tracker', 'keke tracker', 'tracking device', 'car tracking', 'fleet tracking', 'fleet management', 'anti theft tracker', 'obd tracker', 'asset tracker', 'magnetic tracker', 'personal tracker', 'kids tracker', 'child tracker', 'elderly tracker', 'pet tracker', 'dog tracker', 'cattle tracker', 'livestock tracker', 'airtag', 'smart tag', 'speed limiter', 'speed governor', 'immobiliser', 'immobilizer', 'teltonika', 'cantrack']::TEXT[],
  ARRAY['Ask to see it working: its position live on the tracking app before you pay', 'Check the IMEI on the tracker matches the box and the app', 'Ask which SIM or network it needs, and whether the app''s plan is paid and for how long', 'For a vehicle tracker, agree who fits it and test the cut-off before paying for installation']::TEXT[],
  CURRENT_TIMESTAMP
FROM "classified_categories" p
JOIN "classified_categories" s ON s."slug" = 'security-surveillance'
WHERE p."slug" = 'electronics'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "classified_category_sku_prefixes" ("prefix", "category_id")
SELECT "sku_prefix", "id" FROM "classified_categories" WHERE "slug" = 'gps-trackers'
ON CONFLICT ("prefix") DO NOTHING;
DROP FUNCTION pg_temp.udz_free_prefix(TEXT[]);

-- Open wherever Electronics is, as it is there.
INSERT INTO "classified_category_countries" ("category_id", "country", "enabled")
SELECT c."id", pc."country", pc."enabled"
FROM "classified_category_countries" pc
JOIN "classified_categories" p ON p."id" = pc."category_id" AND p."slug" = 'electronics'
CROSS JOIN "classified_categories" c
WHERE c."slug" = 'gps-trackers'
ON CONFLICT ("category_id", "country") DO NOTHING;

-- What buyers ask of a tracker.
INSERT INTO "classified_features" ("id", "key", "name", "icon", "data_type", "unit", "choices", "default_value", "placeholder", "min", "max", "synonyms", "filterable", "updated_at") VALUES
  (gen_random_uuid(), 'tracker_type', 'Tracks', 'locate-fixed', 'choice', NULL, ARRAY['Car or truck', 'Motorcycle or keke', 'Fleet', 'Personal', 'Child or elderly', 'Pet', 'Livestock', 'Asset or cargo']::TEXT[], NULL, NULL, NULL, NULL, ARRAY['car tracker', 'vehicle', 'pet tracker', 'personal tracker', 'asset tracker']::TEXT[], true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'tracker_network', 'Network', 'signal-high', 'choice', NULL, ARRAY['4G', '4G and 2G', '2G', 'NB-IoT or LTE-M', 'Bluetooth only']::TEXT[], NULL, NULL, NULL, NULL, ARRAY['4g', '2g', 'gsm', 'lte', 'bluetooth']::TEXT[], true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'tracking_plan', 'Tracking app plan included', 'smartphone', 'boolean', NULL, ARRAY[]::TEXT[], 'false', NULL, NULL, NULL, ARRAY['subscription', 'platform fee', 'app subscription', 'tracking app']::TEXT[], true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "classified_category_features" ("category_id", "feature_id", "position", "filter", "placeholder")
SELECT c."id", f."id", v."position", v."filter" AND f."filterable", v."placeholder" FROM (VALUES
  ('brand', 0, true, NULL),
  ('model', 1, false, NULL),
  ('tracker_type', 2, true, NULL),
  ('tracker_network', 3, true, NULL),
  ('tracking_plan', 4, true, NULL),
  ('installation', 5, true, NULL),
  ('sim', 6, false, NULL),
  ('voltage', 7, false, 'e.g. 12 for a car, 9 to 90 for an e-bike'),
  ('warranty', 8, false, NULL),
  ('included', 9, false, 'e.g. relay for engine cut-off, SOS button, microphone')
) AS v("key", "position", "filter", "placeholder")
JOIN "classified_categories" c ON c."slug" = 'gps-trackers' JOIN "classified_features" f ON f."key" = v."key"
ON CONFLICT DO NOTHING;

-- Tracker brands the registry lacked; Cantrack with its own mark and colour.
INSERT INTO "classified_brands" ("id", "slug", "name", "name_key", "aliases", "match_keys", "logo_file", "color", "updated_at") VALUES
  (gen_random_uuid(), 'cantrack', 'Cantrack', 'cantrack', ARRAY['cantrack gps', 'secumore']::TEXT[], ARRAY['cantrack', 'cantrackgps', 'secumore']::TEXT[], 'cantrack', '#376AB3', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'teltonika', 'Teltonika', 'teltonika', ARRAY[]::TEXT[], ARRAY['teltonika']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'concox', 'Concox', 'concox', ARRAY[]::TEXT[], ARRAY['concox']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'coban', 'Coban', 'coban', ARRAY[]::TEXT[], ARRAY['coban']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'sinotrack', 'Sinotrack', 'sinotrack', ARRAY[]::TEXT[], ARRAY['sinotrack']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'jimi-iot', 'Jimi IoT', 'jimiiot', ARRAY['jimi']::TEXT[], ARRAY['jimiiot', 'jimi']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'queclink', 'Queclink', 'queclink', ARRAY[]::TEXT[], ARRAY['queclink']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'meitrack', 'Meitrack', 'meitrack', ARRAY[]::TEXT[], ARRAY['meitrack']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ruptela', 'Ruptela', 'ruptela', ARRAY[]::TEXT[], ARRAY['ruptela']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'wanwaytech', 'Wanwaytech', 'wanwaytech', ARRAY['wanway']::TEXT[], ARRAY['wanwaytech', 'wanway']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'tile', 'Tile', 'tile', ARRAY[]::TEXT[], ARRAY['tile']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'tracki', 'Tracki', 'tracki', ARRAY[]::TEXT[], ARRAY['tracki']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'invoxia', 'Invoxia', 'invoxia', ARRAY[]::TEXT[], ARRAY['invoxia']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Its brands, Cantrack first; Apple (AirTag), Samsung (SmartTag) and Garmin already in the registry are linked.
INSERT INTO "classified_brand_categories" ("brand_id", "category_id", "position")
SELECT b."id", c."id", u."position" - 1
FROM unnest(ARRAY['cantrack', 'teltonika', 'concox', 'coban', 'sinotrack', 'jimiiot', 'queclink', 'meitrack', 'ruptela', 'wanwaytech', 'apple', 'samsung', 'tile', 'garmin', 'tracki', 'invoxia']::TEXT[]) WITH ORDINALITY AS u("brand", "position")
JOIN "classified_brands" b ON b."name_key" = u."brand"
JOIN "classified_categories" c ON c."slug" = 'gps-trackers'
ON CONFLICT DO NOTHING;

-- Their models in this category: Cantrack's as its site lists them, then a few of the others' best known.
INSERT INTO "classified_brand_models" ("id", "brand_id", "category_id", "name", "name_key", "aliases", "match_keys", "position", "updated_at")
SELECT gen_random_uuid(), b."id", c."id", v."name", v."name_key", v."aliases", v."match_keys", v."position", CURRENT_TIMESTAMP FROM (VALUES
  ('cantrack', 'G900LM', 'g900lm', ARRAY['g900lm ibutton']::TEXT[], ARRAY['g900lm', 'g900lmibutton']::TEXT[], 0),
  ('cantrack', 'G900LV', 'g900lv', ARRAY[]::TEXT[], ARRAY['g900lv']::TEXT[], 1),
  ('cantrack', 'G900P', 'g900p', ARRAY[]::TEXT[], ARRAY['g900p']::TEXT[], 2),
  ('cantrack', 'G900LS', 'g900ls', ARRAY[]::TEXT[], ARRAY['g900ls']::TEXT[], 3),
  ('cantrack', 'G06L', 'g06l', ARRAY[]::TEXT[], ARRAY['g06l']::TEXT[], 4),
  ('cantrack', 'G07L', 'g07l', ARRAY[]::TEXT[], ARRAY['g07l']::TEXT[], 5),
  ('cantrack', 'C32Plus', 'c32plus', ARRAY['c32 plus']::TEXT[], ARRAY['c32plus']::TEXT[], 6),
  ('cantrack', 'TK08AL', 'tk08al', ARRAY[]::TEXT[], ARRAY['tk08al']::TEXT[], 7),
  ('cantrack', 'TK08A', 'tk08a', ARRAY[]::TEXT[], ARRAY['tk08a']::TEXT[], 8),
  ('cantrack', 'TK100', 'tk100', ARRAY['gt06']::TEXT[], ARRAY['tk100', 'gt06']::TEXT[], 9),
  ('cantrack', 'TK100B', 'tk100b', ARRAY[]::TEXT[], ARRAY['tk100b']::TEXT[], 10),
  ('cantrack', 'TK100N', 'tk100n', ARRAY[]::TEXT[], ARRAY['tk100n']::TEXT[], 11),
  ('cantrack', 'TK103B', 'tk103b', ARRAY[]::TEXT[], ARRAY['tk103b']::TEXT[], 12),
  ('cantrack', 'G05N', 'g05n', ARRAY[]::TEXT[], ARRAY['g05n']::TEXT[], 13),
  ('cantrack', 'VSL100 speed limiter', 'vsl100speedlimiter', ARRAY['vsl100']::TEXT[], ARRAY['vsl100speedlimiter', 'vsl100']::TEXT[], 14),
  ('cantrack', 'G08L tail light tracker', 'g08ltaillighttracker', ARRAY['g08l']::TEXT[], ARRAY['g08ltaillighttracker', 'g08l']::TEXT[], 15),
  ('cantrack', 'G09L tail light tracker', 'g09ltaillighttracker', ARRAY['g09l']::TEXT[], ARRAY['g09ltaillighttracker', 'g09l']::TEXT[], 16),
  ('cantrack', 'GF70L solar asset tracker', 'gf70lsolarassettracker', ARRAY['gf70l']::TEXT[], ARRAY['gf70lsolarassettracker', 'gf70l']::TEXT[], 17),
  ('cantrack', 'GF60', 'gf60', ARRAY[]::TEXT[], ARRAY['gf60']::TEXT[], 18),
  ('cantrack', 'GF50', 'gf50', ARRAY[]::TEXT[], ARRAY['gf50']::TEXT[], 19),
  ('cantrack', 'GF40', 'gf40', ARRAY[]::TEXT[], ARRAY['gf40']::TEXT[], 20),
  ('cantrack', 'GF200LS', 'gf200ls', ARRAY[]::TEXT[], ARRAY['gf200ls']::TEXT[], 21),
  ('cantrack', 'P02L', 'p02l', ARRAY[]::TEXT[], ARRAY['p02l']::TEXT[], 22),
  ('cantrack', 'P901', 'p901', ARRAY[]::TEXT[], ARRAY['p901']::TEXT[], 23),
  ('cantrack', 'P60L', 'p60l', ARRAY[]::TEXT[], ARRAY['p60l']::TEXT[], 24),
  ('cantrack', 'G01', 'g01', ARRAY[]::TEXT[], ARRAY['g01']::TEXT[], 25),
  ('cantrack', 'NB20 pet tracker', 'nb20pettracker', ARRAY['nb20', 'petcute']::TEXT[], ARRAY['nb20pettracker', 'nb20', 'petcute']::TEXT[], 26),
  ('cantrack', 'G02M pet tracker', 'g02mpettracker', ARRAY['g02m']::TEXT[], ARRAY['g02mpettracker', 'g02m']::TEXT[], 27),
  ('cantrack', 'G200NY livestock tracker', 'g200nylivestocktracker', ARRAY['g200ny']::TEXT[], ARRAY['g200nylivestocktracker', 'g200ny']::TEXT[], 28),
  ('cantrack', 'YG119 hunting dog tracker', 'yg119huntingdogtracker', ARRAY['yg119']::TEXT[], ARRAY['yg119huntingdogtracker', 'yg119']::TEXT[], 29),
  ('teltonika', 'FMB920', 'fmb920', ARRAY[]::TEXT[], ARRAY['fmb920']::TEXT[], 0),
  ('teltonika', 'FMB120', 'fmb120', ARRAY[]::TEXT[], ARRAY['fmb120']::TEXT[], 1),
  ('teltonika', 'FMC130', 'fmc130', ARRAY[]::TEXT[], ARRAY['fmc130']::TEXT[], 2),
  ('concox', 'GT06N', 'gt06n', ARRAY[]::TEXT[], ARRAY['gt06n']::TEXT[], 0),
  ('coban', 'TK103B', 'tk103b', ARRAY[]::TEXT[], ARRAY['tk103b']::TEXT[], 0),
  ('sinotrack', 'ST-901', 'st901', ARRAY[]::TEXT[], ARRAY['st901']::TEXT[], 0),
  ('queclink', 'GV300', 'gv300', ARRAY[]::TEXT[], ARRAY['gv300']::TEXT[], 0),
  ('apple', 'AirTag', 'airtag', ARRAY[]::TEXT[], ARRAY['airtag']::TEXT[], 0),
  ('samsung', 'Galaxy SmartTag2', 'galaxysmarttag2', ARRAY['smarttag2', 'smart tag']::TEXT[], ARRAY['galaxysmarttag2', 'smarttag2', 'smarttag']::TEXT[], 0)
) AS v("brand", "name", "name_key", "aliases", "match_keys", "position")
JOIN "classified_brands" b ON b."name_key" = v."brand"
JOIN "classified_categories" c ON c."slug" = 'gps-trackers'
ON CONFLICT DO NOTHING;
