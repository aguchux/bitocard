-- Hospital and medical equipment (3 November 2026, the owner's request; docs/UDOZO_HOME_ROWS_PLAN.md part B): a top
-- category again, after Beauty and personal care, with home care and monitoring (Health and mobility aids moved here,
-- its slug kept), mobility and patient care, clinic and hospital equipment, laboratory equipment, and medical supplies
-- and PPE. Their features, brands and models (written from knowledge of these markets and reviewed by sampling: sellers
-- can still type their own, and admins turn wrong ones off), the Safe Trade Guide's checks, and refused words for what may
-- never be sold. Open in every market as Beauty and personal care is.

-- Room after Beauty and personal care.
UPDATE "classified_categories" SET "position" = "position" + 1, "updated_at" = CURRENT_TIMESTAMP
WHERE "parent_id" IS NULL AND "position" >= 7 AND "slug" <> 'medical-equipment';

-- The top category: the old one (switched off on 31 October where it had listings) comes back at the top, else a new one.
UPDATE "classified_categories" SET "parent_id" = NULL, "name" = 'Hospital and medical equipment', "icon" = 'stethoscope', "position" = 7, "b2b" = false, "enabled" = true, "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'medical-equipment';

-- A free three-letter prefix: the first of the wished ones no category has had, else the first free one.
CREATE FUNCTION pg_temp.udz_free_prefix(wished TEXT[]) RETURNS CHAR(3) AS $$
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

INSERT INTO "classified_categories" ("id", "slug", "name", "icon", "position", "enabled", "sku_prefix", "updated_at")
SELECT gen_random_uuid(), 'medical-equipment', 'Hospital and medical equipment', 'stethoscope', 7, true, pg_temp.udz_free_prefix(ARRAY['MED', 'MDE', 'HME']), CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "classified_categories" WHERE "slug" = 'medical-equipment');

-- Home care and monitoring: Health and mobility aids moves here, its slug, listings, brands and models kept.
UPDATE "classified_categories" SET "parent_id" = (SELECT "id" FROM "classified_categories" WHERE "slug" = 'medical-equipment'), "name" = 'Home care and monitoring', "icon" = 'heart-pulse', "position" = 0, "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'health-equipment';

INSERT INTO "classified_categories" ("id", "parent_id", "slug", "name", "icon", "position", "enabled", "sku_prefix", "updated_at")
SELECT gen_random_uuid(), p."id", 'mobility-patient-care', 'Mobility and patient care', 'accessibility', 1, true, pg_temp.udz_free_prefix(ARRAY['MOB', 'MPC', 'WHC']::TEXT[]), CURRENT_TIMESTAMP
FROM "classified_categories" p WHERE p."slug" = 'medical-equipment'
ON CONFLICT ("slug") DO UPDATE SET "parent_id" = EXCLUDED."parent_id", "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "position" = EXCLUDED."position", "enabled" = true, "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "classified_categories" ("id", "parent_id", "slug", "name", "icon", "position", "enabled", "sku_prefix", "updated_at")
SELECT gen_random_uuid(), p."id", 'clinic-hospital-equipment', 'Clinic and hospital equipment', 'hospital', 2, true, pg_temp.udz_free_prefix(ARRAY['HSP', 'CLH', 'CHE']::TEXT[]), CURRENT_TIMESTAMP
FROM "classified_categories" p WHERE p."slug" = 'medical-equipment'
ON CONFLICT ("slug") DO UPDATE SET "parent_id" = EXCLUDED."parent_id", "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "position" = EXCLUDED."position", "enabled" = true, "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "classified_categories" ("id", "parent_id", "slug", "name", "icon", "position", "enabled", "sku_prefix", "updated_at")
SELECT gen_random_uuid(), p."id", 'lab-equipment', 'Laboratory equipment', 'microscope', 3, true, pg_temp.udz_free_prefix(ARRAY['LAB', 'LBE', 'LBQ']::TEXT[]), CURRENT_TIMESTAMP
FROM "classified_categories" p WHERE p."slug" = 'medical-equipment'
ON CONFLICT ("slug") DO UPDATE SET "parent_id" = EXCLUDED."parent_id", "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "position" = EXCLUDED."position", "enabled" = true, "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "classified_categories" ("id", "parent_id", "slug", "name", "icon", "position", "enabled", "sku_prefix", "updated_at")
SELECT gen_random_uuid(), p."id", 'medical-supplies', 'Medical supplies and PPE', 'syringe', 4, true, pg_temp.udz_free_prefix(ARRAY['MSP', 'MSU', 'PPE']::TEXT[]), CURRENT_TIMESTAMP
FROM "classified_categories" p WHERE p."slug" = 'medical-equipment'
ON CONFLICT ("slug") DO UPDATE SET "parent_id" = EXCLUDED."parent_id", "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "position" = EXCLUDED."position", "enabled" = true, "updated_at" = CURRENT_TIMESTAMP;

-- Every prefix a category has had stays its own.
INSERT INTO "classified_category_sku_prefixes" ("prefix", "category_id")
SELECT c."sku_prefix", c."id" FROM "classified_categories" c
WHERE c."slug" IN ('medical-equipment', 'mobility-patient-care', 'clinic-hospital-equipment', 'lab-equipment', 'medical-supplies')
ON CONFLICT ("prefix") DO NOTHING;

-- Open wherever Beauty and personal care is, as it is there.
INSERT INTO "classified_category_countries" ("category_id", "country", "enabled")
SELECT c."id", cc."country", cc."enabled"
FROM "classified_category_countries" cc
JOIN "classified_categories" hb ON hb."id" = cc."category_id" AND hb."slug" = 'health-beauty'
CROSS JOIN "classified_categories" c
WHERE c."slug" IN ('medical-equipment', 'mobility-patient-care', 'clinic-hospital-equipment', 'lab-equipment', 'medical-supplies')
ON CONFLICT ("category_id", "country") DO NOTHING;
UPDATE "classified_category_countries" cc SET "enabled" = hb_cc."enabled"
FROM "classified_categories" c, "classified_categories" hb, "classified_category_countries" hb_cc
WHERE cc."category_id" = c."id" AND c."slug" = 'medical-equipment' AND hb."slug" = 'health-beauty' AND hb_cc."category_id" = hb."id" AND hb_cc."country" = cc."country";

-- What to check before paying (the Safe Trade Guide); the subcategories use their parent's.
UPDATE "classified_categories" SET "safety_checklist" = ARRAY[
  'Switch it on and test it in front of you; for a monitor or analyser, ask to see a reading or a test run.',
  'Check the seal and the expiry date on anything sterile or single use: never buy one opened or out of date.',
  'Ask for the product''s registration number (NAFDAC, FDA Ghana, PPB Kenya) and check it on the regulator''s site.',
  'Ask for the manual, the charger or power cable, and the service or calibration record of hospital equipment.',
  'Pay through Udozo''s Safe pay, never before you have seen and tested it.'
]::TEXT[], "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'medical-equipment';
UPDATE "classified_categories" SET "safety_checklist" = ARRAY[]::TEXT[], "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" IN ('health-equipment', 'mobility-patient-care', 'clinic-hospital-equipment', 'lab-equipment', 'medical-supplies');

-- Features buyers ask about here.
INSERT INTO "classified_features" ("id", "key", "name", "icon", "data_type", "unit", "choices", "default_value", "placeholder", "min", "max", "synonyms", "filterable", "updated_at") VALUES
  (gen_random_uuid(), 'power_source', 'Power', 'plug-zap', 'choice', NULL, ARRAY['Mains', 'Battery', 'Mains and battery']::TEXT[], NULL, NULL, NULL, NULL, ARRAY['rechargeable', 'electric', 'battery powered']::TEXT[], true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'certification', 'Certification', 'badge-check', 'choice', NULL, ARRAY['CE', 'FDA', 'ISO 13485']::TEXT[], NULL, NULL, NULL, NULL, ARRAY['ce marked', 'fda approved', 'iso']::TEXT[], true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'sterile', 'Sterile', 'shield-plus', 'boolean', NULL, ARRAY[]::TEXT[], 'false', NULL, NULL, NULL, ARRAY['sterilised', 'sterilized']::TEXT[], true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "classified_category_features" ("category_id", "feature_id", "position", "filter", "placeholder")
SELECT c."id", f."id", v."position" + 1 + COALESCE((SELECT MAX(e."position") FROM "classified_category_features" e WHERE e."category_id" = c."id"), -1), v."filter" AND f."filterable", v."placeholder" FROM (VALUES
  ('health-equipment', 'brand', 0, true, NULL),
  ('health-equipment', 'model', 1, false, NULL),
  ('health-equipment', 'power_source', 2, true, NULL),
  ('health-equipment', 'registration_number', 3, false, NULL),
  ('health-equipment', 'warranty', 4, false, NULL),
  ('mobility-patient-care', 'brand', 0, true, NULL),
  ('mobility-patient-care', 'model', 1, false, NULL),
  ('mobility-patient-care', 'max_weight', 2, false, NULL),
  ('mobility-patient-care', 'power_source', 3, true, NULL),
  ('mobility-patient-care', 'warranty', 4, false, NULL),
  ('mobility-patient-care', 'included', 5, false, NULL),
  ('clinic-hospital-equipment', 'brand', 0, true, NULL),
  ('clinic-hospital-equipment', 'model', 1, false, NULL),
  ('clinic-hospital-equipment', 'power_source', 2, true, NULL),
  ('clinic-hospital-equipment', 'certification', 3, true, NULL),
  ('clinic-hospital-equipment', 'registration_number', 4, false, NULL),
  ('clinic-hospital-equipment', 'warranty', 5, false, NULL),
  ('clinic-hospital-equipment', 'included', 6, false, NULL),
  ('lab-equipment', 'brand', 0, true, NULL),
  ('lab-equipment', 'model', 1, false, NULL),
  ('lab-equipment', 'power_source', 2, true, NULL),
  ('lab-equipment', 'certification', 3, true, NULL),
  ('lab-equipment', 'warranty', 4, false, NULL),
  ('lab-equipment', 'included', 5, false, NULL),
  ('medical-supplies', 'brand', 0, true, NULL),
  ('medical-supplies', 'pack_size', 1, false, NULL),
  ('medical-supplies', 'sterile', 2, true, NULL),
  ('medical-supplies', 'sealed', 3, true, NULL),
  ('medical-supplies', 'expiry', 4, false, NULL),
  ('medical-supplies', 'registration_number', 5, false, NULL),
  ('medical-supplies', 'quantity_available', 6, false, NULL)
) AS v("slug", "key", "position", "filter", "placeholder") JOIN "classified_categories" c ON c."slug" = v."slug" JOIN "classified_features" f ON f."key" = v."key"
ON CONFLICT DO NOTHING;

-- Olympus's microscopes need the name for themselves: OM System (Olympus's cameras until 2021) keeps its own name only.
UPDATE "classified_brands" SET "aliases" = array_remove("aliases", 'olympus'), "match_keys" = array_remove("match_keys", 'olympus'), "updated_at" = CURRENT_TIMESTAMP
WHERE "slug" = 'om-system';

-- Brands this category needs that the registry lacked (no logos bundled yet: they show their initials).
INSERT INTO "classified_brands" ("id", "slug", "name", "name_key", "aliases", "match_keys", "logo_file", "color", "updated_at") VALUES
  (gen_random_uuid(), 'mindray', 'Mindray', 'mindray', ARRAY[]::TEXT[], ARRAY['mindray']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ge-healthcare', 'GE HealthCare', 'gehealthcare', ARRAY['ge healthcare', 'ge medical']::TEXT[], ARRAY['gehealthcare', 'gemedical']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'edan', 'Edan', 'edan', ARRAY[]::TEXT[], ARRAY['edan']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'welch-allyn', 'Welch Allyn', 'welchallyn', ARRAY['hillrom']::TEXT[], ARRAY['welchallyn', 'hillrom']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'riester', 'Riester', 'riester', ARRAY[]::TEXT[], ARRAY['riester']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'drager', 'Dräger', 'drager', ARRAY['draeger']::TEXT[], ARRAY['drager', 'draeger']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'nihon-kohden', 'Nihon Kohden', 'nihonkohden', ARRAY[]::TEXT[], ARRAY['nihonkohden']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'biolight', 'Biolight', 'biolight', ARRAY[]::TEXT[], ARRAY['biolight']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'comen', 'Comen', 'comen', ARRAY[]::TEXT[], ARRAY['comen']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'sunrise-medical', 'Sunrise Medical', 'sunrisemedical', ARRAY['quickie']::TEXT[], ARRAY['sunrisemedical', 'quickie']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'karma-medical', 'Karma', 'karma', ARRAY['karma medical']::TEXT[], ARRAY['karma', 'karmamedical']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ottobock', 'Ottobock', 'ottobock', ARRAY['otto bock']::TEXT[], ARRAY['ottobock']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'permobil', 'Permobil', 'permobil', ARRAY[]::TEXT[], ARRAY['permobil']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'medline', 'Medline', 'medline', ARRAY[]::TEXT[], ARRAY['medline']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'olympus', 'Olympus', 'olympus', ARRAY['evident']::TEXT[], ARRAY['olympus', 'evident']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'sysmex', 'Sysmex', 'sysmex', ARRAY[]::TEXT[], ARRAY['sysmex']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'abbott', 'Abbott', 'abbott', ARRAY['freestyle']::TEXT[], ARRAY['abbott', 'freestyle']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'roche', 'Roche', 'roche', ARRAY['cobas']::TEXT[], ARRAY['roche', 'cobas']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'beckman-coulter', 'Beckman Coulter', 'beckmancoulter', ARRAY[]::TEXT[], ARRAY['beckmancoulter']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'thermo-fisher', 'Thermo Fisher Scientific', 'thermofisherscientific', ARRAY['thermo fisher', 'thermo scientific']::TEXT[], ARRAY['thermofisherscientific', 'thermofisher', 'thermoscientific']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'eppendorf', 'Eppendorf', 'eppendorf', ARRAY[]::TEXT[], ARRAY['eppendorf']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '3m', '3M', '3m', ARRAY[]::TEXT[], ARRAY['3m']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'bd', 'BD', 'bd', ARRAY['becton dickinson']::TEXT[], ARRAY['bd', 'bectondickinson']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'nipro', 'Nipro', 'nipro', ARRAY[]::TEXT[], ARRAY['nipro']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'terumo', 'Terumo', 'terumo', ARRAY[]::TEXT[], ARRAY['terumo']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ansell', 'Ansell', 'ansell', ARRAY[]::TEXT[], ARRAY['ansell']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'hartmann', 'Hartmann', 'hartmann', ARRAY['paul hartmann']::TEXT[], ARRAY['hartmann', 'paulhartmann']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'molnlycke', 'Mölnlycke', 'molnlycke', ARRAY['molnlycke']::TEXT[], ARRAY['molnlycke']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'top-glove', 'Top Glove', 'topglove', ARRAY[]::TEXT[], ARRAY['topglove']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'supermax', 'Supermax', 'supermax', ARRAY[]::TEXT[], ARRAY['supermax']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'inogen', 'Inogen', 'inogen', ARRAY[]::TEXT[], ARRAY['inogen']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'longfian', 'Longfian', 'longfian', ARRAY[]::TEXT[], ARRAY['longfian']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'pride-mobility', 'Pride Mobility', 'pridemobility', ARRAY['pride']::TEXT[], ARRAY['pridemobility', 'pride']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'merits-health', 'Merits', 'merits', ARRAY['merits health']::TEXT[], ARRAY['merits', 'meritshealth']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'kaiyang', 'Kaiyang', 'kaiyang', ARRAY[]::TEXT[], ARRAY['kaiyang']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'biobase', 'Biobase', 'biobase', ARRAY[]::TEXT[], ARRAY['biobase']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'rayto', 'Rayto', 'rayto', ARRAY[]::TEXT[], ARRAY['rayto']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'dirui', 'Dirui', 'dirui', ARRAY[]::TEXT[], ARRAY['dirui']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Which brands each subcategory offers, most bought first (an existing brand is linked, never made twice).
INSERT INTO "classified_brand_categories" ("brand_id", "category_id", "position")
SELECT b."id", c."id", v."position" FROM (VALUES
  ('abbott', 'health-equipment', 100),
  ('inogen', 'health-equipment', 101),
  ('longfian', 'health-equipment', 102),
  ('invacare', 'mobility-patient-care', 0),
  ('drivemedical', 'mobility-patient-care', 1),
  ('sunrisemedical', 'mobility-patient-care', 2),
  ('karma', 'mobility-patient-care', 3),
  ('ottobock', 'mobility-patient-care', 4),
  ('permobil', 'mobility-patient-care', 5),
  ('pridemobility', 'mobility-patient-care', 6),
  ('merits', 'mobility-patient-care', 7),
  ('kaiyang', 'mobility-patient-care', 8),
  ('medline', 'mobility-patient-care', 9),
  ('yuwell', 'mobility-patient-care', 10),
  ('mindray', 'clinic-hospital-equipment', 0),
  ('philips', 'clinic-hospital-equipment', 1),
  ('gehealthcare', 'clinic-hospital-equipment', 2),
  ('siemens', 'clinic-hospital-equipment', 3),
  ('edan', 'clinic-hospital-equipment', 4),
  ('contec', 'clinic-hospital-equipment', 5),
  ('welchallyn', 'clinic-hospital-equipment', 6),
  ('riester', 'clinic-hospital-equipment', 7),
  ('drager', 'clinic-hospital-equipment', 8),
  ('nihonkohden', 'clinic-hospital-equipment', 9),
  ('biolight', 'clinic-hospital-equipment', 10),
  ('comen', 'clinic-hospital-equipment', 11),
  ('yuwell', 'clinic-hospital-equipment', 12),
  ('omron', 'clinic-hospital-equipment', 13),
  ('olympus', 'lab-equipment', 0),
  ('mindray', 'lab-equipment', 1),
  ('sysmex', 'lab-equipment', 2),
  ('abbott', 'lab-equipment', 3),
  ('roche', 'lab-equipment', 4),
  ('beckmancoulter', 'lab-equipment', 5),
  ('thermofisherscientific', 'lab-equipment', 6),
  ('eppendorf', 'lab-equipment', 7),
  ('hettich', 'lab-equipment', 8),
  ('biobase', 'lab-equipment', 9),
  ('rayto', 'lab-equipment', 10),
  ('dirui', 'lab-equipment', 11),
  ('3m', 'medical-supplies', 0),
  ('bd', 'medical-supplies', 1),
  ('nipro', 'medical-supplies', 2),
  ('terumo', 'medical-supplies', 3),
  ('medline', 'medical-supplies', 4),
  ('ansell', 'medical-supplies', 5),
  ('hartmann', 'medical-supplies', 6),
  ('molnlycke', 'medical-supplies', 7),
  ('topglove', 'medical-supplies', 8),
  ('supermax', 'medical-supplies', 9)
) AS v("brand", "category", "position")
JOIN "classified_brands" b ON b."name_key" = v."brand"
JOIN "classified_categories" c ON c."slug" = v."category"
ON CONFLICT DO NOTHING;

-- Their models, each brand's best known first.
INSERT INTO "classified_brand_models" ("id", "brand_id", "category_id", "name", "name_key", "aliases", "match_keys", "position", "updated_at")
SELECT gen_random_uuid(), b."id", c."id", v."name", v."name_key", v."aliases", v."match_keys", v."position", CURRENT_TIMESTAMP FROM (VALUES
  ('health-equipment', 'abbott', 'FreeStyle Libre 2', 'freestylelibre2', ARRAY['libre 2']::TEXT[], ARRAY['freestylelibre2', 'libre2']::TEXT[], 0),
  ('health-equipment', 'abbott', 'FreeStyle Libre 3', 'freestylelibre3', ARRAY['libre 3']::TEXT[], ARRAY['freestylelibre3', 'libre3']::TEXT[], 1),
  ('health-equipment', 'abbott', 'FreeStyle Optium Neo', 'freestyleoptiumneo', ARRAY[]::TEXT[], ARRAY['freestyleoptiumneo']::TEXT[], 2),
  ('health-equipment', 'inogen', 'One G5', 'oneg5', ARRAY['g5']::TEXT[], ARRAY['oneg5', 'g5']::TEXT[], 0),
  ('health-equipment', 'inogen', 'One G4', 'oneg4', ARRAY['g4']::TEXT[], ARRAY['oneg4', 'g4']::TEXT[], 1),
  ('health-equipment', 'inogen', 'One G3', 'oneg3', ARRAY['g3']::TEXT[], ARRAY['oneg3', 'g3']::TEXT[], 2),
  ('health-equipment', 'longfian', 'JAY-5', 'jay5', ARRAY['jay5']::TEXT[], ARRAY['jay5']::TEXT[], 0),
  ('health-equipment', 'longfian', 'JAY-10', 'jay10', ARRAY['jay10']::TEXT[], ARRAY['jay10']::TEXT[], 1),
  ('mobility-patient-care', 'invacare', 'Action3 NG', 'action3ng', ARRAY[]::TEXT[], ARRAY['action3ng']::TEXT[], 0),
  ('mobility-patient-care', 'invacare', 'Action2 NG', 'action2ng', ARRAY[]::TEXT[], ARRAY['action2ng']::TEXT[], 1),
  ('mobility-patient-care', 'invacare', 'Etude Plus', 'etudeplus', ARRAY[]::TEXT[], ARRAY['etudeplus']::TEXT[], 2),
  ('mobility-patient-care', 'invacare', 'SB755', 'sb755', ARRAY[]::TEXT[], ARRAY['sb755']::TEXT[], 3),
  ('mobility-patient-care', 'invacare', 'Dolomite Jazz', 'dolomitejazz', ARRAY[]::TEXT[], ARRAY['dolomitejazz']::TEXT[], 4),
  ('mobility-patient-care', 'drivemedical', 'Silver Sport 2', 'silversport2', ARRAY[]::TEXT[], ARRAY['silversport2']::TEXT[], 0),
  ('mobility-patient-care', 'drivemedical', 'Cruiser III', 'cruiseriii', ARRAY[]::TEXT[], ARRAY['cruiseriii']::TEXT[], 1),
  ('mobility-patient-care', 'drivemedical', 'Blue Streak', 'bluestreak', ARRAY[]::TEXT[], ARRAY['bluestreak']::TEXT[], 2),
  ('mobility-patient-care', 'drivemedical', 'Nitro', 'nitro', ARRAY[]::TEXT[], ARRAY['nitro']::TEXT[], 3),
  ('mobility-patient-care', 'sunrisemedical', 'Quickie Q50 R', 'quickieq50r', ARRAY['q50']::TEXT[], ARRAY['quickieq50r', 'q50']::TEXT[], 0),
  ('mobility-patient-care', 'sunrisemedical', 'Quickie Nitrum', 'quickienitrum', ARRAY[]::TEXT[], ARRAY['quickienitrum']::TEXT[], 1),
  ('mobility-patient-care', 'sunrisemedical', 'Breezy Premier', 'breezypremier', ARRAY[]::TEXT[], ARRAY['breezypremier']::TEXT[], 2),
  ('mobility-patient-care', 'karma', 'KM-2500', 'km2500', ARRAY[]::TEXT[], ARRAY['km2500']::TEXT[], 0),
  ('mobility-patient-care', 'karma', 'Ergo Lite', 'ergolite', ARRAY[]::TEXT[], ARRAY['ergolite']::TEXT[], 1),
  ('mobility-patient-care', 'karma', 'Flexx', 'flexx', ARRAY[]::TEXT[], ARRAY['flexx']::TEXT[], 2),
  ('mobility-patient-care', 'ottobock', 'Start M1', 'startm1', ARRAY[]::TEXT[], ARRAY['startm1']::TEXT[], 0),
  ('mobility-patient-care', 'ottobock', 'Avantgarde 4', 'avantgarde4', ARRAY[]::TEXT[], ARRAY['avantgarde4']::TEXT[], 1),
  ('mobility-patient-care', 'permobil', 'M3 Corpus', 'm3corpus', ARRAY[]::TEXT[], ARRAY['m3corpus']::TEXT[], 0),
  ('mobility-patient-care', 'permobil', 'F5 Corpus', 'f5corpus', ARRAY[]::TEXT[], ARRAY['f5corpus']::TEXT[], 1),
  ('mobility-patient-care', 'pridemobility', 'Go-Go Elite Traveller', 'gogoelitetraveller', ARRAY[]::TEXT[], ARRAY['gogoelitetraveller']::TEXT[], 0),
  ('mobility-patient-care', 'pridemobility', 'Jazzy Select 6', 'jazzyselect6', ARRAY[]::TEXT[], ARRAY['jazzyselect6']::TEXT[], 1),
  ('mobility-patient-care', 'kaiyang', 'KY809', 'ky809', ARRAY[]::TEXT[], ARRAY['ky809']::TEXT[], 0),
  ('mobility-patient-care', 'kaiyang', 'KY875', 'ky875', ARRAY[]::TEXT[], ARRAY['ky875']::TEXT[], 1),
  ('clinic-hospital-equipment', 'mindray', 'iMEC 10', 'imec10', ARRAY['imec10']::TEXT[], ARRAY['imec10']::TEXT[], 0),
  ('clinic-hospital-equipment', 'mindray', 'iMEC 12', 'imec12', ARRAY[]::TEXT[], ARRAY['imec12']::TEXT[], 1),
  ('clinic-hospital-equipment', 'mindray', 'iMEC 8', 'imec8', ARRAY[]::TEXT[], ARRAY['imec8']::TEXT[], 2),
  ('clinic-hospital-equipment', 'mindray', 'uMEC 10', 'umec10', ARRAY[]::TEXT[], ARRAY['umec10']::TEXT[], 3),
  ('clinic-hospital-equipment', 'mindray', 'uMEC 12', 'umec12', ARRAY[]::TEXT[], ARRAY['umec12']::TEXT[], 4),
  ('clinic-hospital-equipment', 'mindray', 'ePM 10', 'epm10', ARRAY[]::TEXT[], ARRAY['epm10']::TEXT[], 5),
  ('clinic-hospital-equipment', 'mindray', 'ePM 12', 'epm12', ARRAY[]::TEXT[], ARRAY['epm12']::TEXT[], 6),
  ('clinic-hospital-equipment', 'mindray', 'BeneHeart R3', 'beneheartr3', ARRAY[]::TEXT[], ARRAY['beneheartr3']::TEXT[], 7),
  ('clinic-hospital-equipment', 'mindray', 'DC-30', 'dc30', ARRAY[]::TEXT[], ARRAY['dc30']::TEXT[], 8),
  ('clinic-hospital-equipment', 'mindray', 'DC-40', 'dc40', ARRAY[]::TEXT[], ARRAY['dc40']::TEXT[], 9),
  ('clinic-hospital-equipment', 'mindray', 'Z60', 'z60', ARRAY[]::TEXT[], ARRAY['z60']::TEXT[], 10),
  ('clinic-hospital-equipment', 'mindray', 'BeneVision N12', 'benevisionn12', ARRAY[]::TEXT[], ARRAY['benevisionn12']::TEXT[], 11),
  ('clinic-hospital-equipment', 'philips', 'IntelliVue MX450', 'intellivuemx450', ARRAY['mx450']::TEXT[], ARRAY['intellivuemx450', 'mx450']::TEXT[], 0),
  ('clinic-hospital-equipment', 'philips', 'IntelliVue MX550', 'intellivuemx550', ARRAY['mx550']::TEXT[], ARRAY['intellivuemx550', 'mx550']::TEXT[], 1),
  ('clinic-hospital-equipment', 'philips', 'Efficia CM10', 'efficiacm10', ARRAY[]::TEXT[], ARRAY['efficiacm10']::TEXT[], 2),
  ('clinic-hospital-equipment', 'philips', 'PageWriter TC30', 'pagewritertc30', ARRAY[]::TEXT[], ARRAY['pagewritertc30']::TEXT[], 3),
  ('clinic-hospital-equipment', 'philips', 'Affiniti 50', 'affiniti50', ARRAY[]::TEXT[], ARRAY['affiniti50']::TEXT[], 4),
  ('clinic-hospital-equipment', 'philips', 'HeartStart FRx', 'heartstartfrx', ARRAY[]::TEXT[], ARRAY['heartstartfrx']::TEXT[], 5),
  ('clinic-hospital-equipment', 'gehealthcare', 'Logiq P9', 'logiqp9', ARRAY[]::TEXT[], ARRAY['logiqp9']::TEXT[], 0),
  ('clinic-hospital-equipment', 'gehealthcare', 'Logiq E10', 'logiqe10', ARRAY[]::TEXT[], ARRAY['logiqe10']::TEXT[], 1),
  ('clinic-hospital-equipment', 'gehealthcare', 'Vivid T8', 'vividt8', ARRAY[]::TEXT[], ARRAY['vividt8']::TEXT[], 2),
  ('clinic-hospital-equipment', 'gehealthcare', 'Voluson E8', 'volusone8', ARRAY[]::TEXT[], ARRAY['volusone8']::TEXT[], 3),
  ('clinic-hospital-equipment', 'gehealthcare', 'Carescape B450', 'carescapeb450', ARRAY[]::TEXT[], ARRAY['carescapeb450']::TEXT[], 4),
  ('clinic-hospital-equipment', 'gehealthcare', 'Dash 4000', 'dash4000', ARRAY[]::TEXT[], ARRAY['dash4000']::TEXT[], 5),
  ('clinic-hospital-equipment', 'gehealthcare', 'MAC 2000', 'mac2000', ARRAY[]::TEXT[], ARRAY['mac2000']::TEXT[], 6),
  ('clinic-hospital-equipment', 'siemens', 'Acuson P500', 'acusonp500', ARRAY[]::TEXT[], ARRAY['acusonp500']::TEXT[], 0),
  ('clinic-hospital-equipment', 'siemens', 'Acuson NX3', 'acusonnx3', ARRAY[]::TEXT[], ARRAY['acusonnx3']::TEXT[], 1),
  ('clinic-hospital-equipment', 'siemens', 'Acuson Redwood', 'acusonredwood', ARRAY[]::TEXT[], ARRAY['acusonredwood']::TEXT[], 2),
  ('clinic-hospital-equipment', 'edan', 'iM50', 'im50', ARRAY[]::TEXT[], ARRAY['im50']::TEXT[], 0),
  ('clinic-hospital-equipment', 'edan', 'iM60', 'im60', ARRAY[]::TEXT[], ARRAY['im60']::TEXT[], 1),
  ('clinic-hospital-equipment', 'edan', 'iM70', 'im70', ARRAY[]::TEXT[], ARRAY['im70']::TEXT[], 2),
  ('clinic-hospital-equipment', 'edan', 'M3', 'm3', ARRAY[]::TEXT[], ARRAY['m3']::TEXT[], 3),
  ('clinic-hospital-equipment', 'edan', 'SE-1200 Express', 'se1200express', ARRAY[]::TEXT[], ARRAY['se1200express']::TEXT[], 4),
  ('clinic-hospital-equipment', 'edan', 'Acclarix AX8', 'acclarixax8', ARRAY[]::TEXT[], ARRAY['acclarixax8']::TEXT[], 5),
  ('clinic-hospital-equipment', 'contec', 'CMS8000', 'cms8000', ARRAY[]::TEXT[], ARRAY['cms8000']::TEXT[], 0),
  ('clinic-hospital-equipment', 'contec', 'ECG1200G', 'ecg1200g', ARRAY[]::TEXT[], ARRAY['ecg1200g']::TEXT[], 1),
  ('clinic-hospital-equipment', 'contec', 'CMS9000', 'cms9000', ARRAY[]::TEXT[], ARRAY['cms9000']::TEXT[], 2),
  ('clinic-hospital-equipment', 'welchallyn', 'Connex Spot Monitor', 'connexspotmonitor', ARRAY[]::TEXT[], ARRAY['connexspotmonitor']::TEXT[], 0),
  ('clinic-hospital-equipment', 'welchallyn', 'Spot Vital Signs 4400', 'spotvitalsigns4400', ARRAY[]::TEXT[], ARRAY['spotvitalsigns4400']::TEXT[], 1),
  ('clinic-hospital-equipment', 'welchallyn', 'PanOptic', 'panoptic', ARRAY[]::TEXT[], ARRAY['panoptic']::TEXT[], 2),
  ('clinic-hospital-equipment', 'riester', 'Big Ben', 'bigben', ARRAY[]::TEXT[], ARRAY['bigben']::TEXT[], 0),
  ('clinic-hospital-equipment', 'riester', 'ri-former', 'riformer', ARRAY[]::TEXT[], ARRAY['riformer']::TEXT[], 1),
  ('clinic-hospital-equipment', 'riester', 'Duplex 2.0', 'duplex20', ARRAY[]::TEXT[], ARRAY['duplex20']::TEXT[], 2),
  ('clinic-hospital-equipment', 'drager', 'Evita V500', 'evitav500', ARRAY[]::TEXT[], ARRAY['evitav500']::TEXT[], 0),
  ('clinic-hospital-equipment', 'drager', 'Savina 300', 'savina300', ARRAY[]::TEXT[], ARRAY['savina300']::TEXT[], 1),
  ('clinic-hospital-equipment', 'drager', 'Fabius plus', 'fabiusplus', ARRAY[]::TEXT[], ARRAY['fabiusplus']::TEXT[], 2),
  ('clinic-hospital-equipment', 'nihonkohden', 'BSM-3500', 'bsm3500', ARRAY[]::TEXT[], ARRAY['bsm3500']::TEXT[], 0),
  ('clinic-hospital-equipment', 'nihonkohden', 'Cardiofax M', 'cardiofaxm', ARRAY[]::TEXT[], ARRAY['cardiofaxm']::TEXT[], 1),
  ('clinic-hospital-equipment', 'biolight', 'Q3', 'q3', ARRAY[]::TEXT[], ARRAY['q3']::TEXT[], 0),
  ('clinic-hospital-equipment', 'biolight', 'Q5', 'q5', ARRAY[]::TEXT[], ARRAY['q5']::TEXT[], 1),
  ('clinic-hospital-equipment', 'biolight', 'M12', 'm12', ARRAY[]::TEXT[], ARRAY['m12']::TEXT[], 2),
  ('clinic-hospital-equipment', 'comen', 'C30', 'c30', ARRAY[]::TEXT[], ARRAY['c30']::TEXT[], 0),
  ('clinic-hospital-equipment', 'comen', 'C60', 'c60', ARRAY[]::TEXT[], ARRAY['c60']::TEXT[], 1),
  ('clinic-hospital-equipment', 'comen', 'H8', 'h8', ARRAY[]::TEXT[], ARRAY['h8']::TEXT[], 2),
  ('clinic-hospital-equipment', 'yuwell', '7E-A', '7ea', ARRAY[]::TEXT[], ARRAY['7ea']::TEXT[], 0),
  ('lab-equipment', 'olympus', 'CX23', 'cx23', ARRAY[]::TEXT[], ARRAY['cx23']::TEXT[], 0),
  ('lab-equipment', 'olympus', 'CX33', 'cx33', ARRAY[]::TEXT[], ARRAY['cx33']::TEXT[], 1),
  ('lab-equipment', 'olympus', 'CX43', 'cx43', ARRAY[]::TEXT[], ARRAY['cx43']::TEXT[], 2),
  ('lab-equipment', 'olympus', 'CKX53', 'ckx53', ARRAY[]::TEXT[], ARRAY['ckx53']::TEXT[], 3),
  ('lab-equipment', 'mindray', 'BC-30s', 'bc30s', ARRAY[]::TEXT[], ARRAY['bc30s']::TEXT[], 0),
  ('lab-equipment', 'mindray', 'BC-20s', 'bc20s', ARRAY[]::TEXT[], ARRAY['bc20s']::TEXT[], 1),
  ('lab-equipment', 'mindray', 'BC-5150', 'bc5150', ARRAY[]::TEXT[], ARRAY['bc5150']::TEXT[], 2),
  ('lab-equipment', 'mindray', 'BC-6200', 'bc6200', ARRAY[]::TEXT[], ARRAY['bc6200']::TEXT[], 3),
  ('lab-equipment', 'mindray', 'BS-240', 'bs240', ARRAY[]::TEXT[], ARRAY['bs240']::TEXT[], 4),
  ('lab-equipment', 'mindray', 'BS-200E', 'bs200e', ARRAY[]::TEXT[], ARRAY['bs200e']::TEXT[], 5),
  ('lab-equipment', 'mindray', 'BA-88A', 'ba88a', ARRAY[]::TEXT[], ARRAY['ba88a']::TEXT[], 6),
  ('lab-equipment', 'sysmex', 'XP-300', 'xp300', ARRAY[]::TEXT[], ARRAY['xp300']::TEXT[], 0),
  ('lab-equipment', 'sysmex', 'XN-350', 'xn350', ARRAY[]::TEXT[], ARRAY['xn350']::TEXT[], 1),
  ('lab-equipment', 'sysmex', 'XN-550', 'xn550', ARRAY[]::TEXT[], ARRAY['xn550']::TEXT[], 2),
  ('lab-equipment', 'sysmex', 'KX-21N', 'kx21n', ARRAY[]::TEXT[], ARRAY['kx21n']::TEXT[], 3),
  ('lab-equipment', 'sysmex', 'XS-1000i', 'xs1000i', ARRAY[]::TEXT[], ARRAY['xs1000i']::TEXT[], 4),
  ('lab-equipment', 'abbott', 'Cell-Dyn Ruby', 'celldynruby', ARRAY[]::TEXT[], ARRAY['celldynruby']::TEXT[], 0),
  ('lab-equipment', 'abbott', 'Architect i1000SR', 'architecti1000sr', ARRAY[]::TEXT[], ARRAY['architecti1000sr']::TEXT[], 1),
  ('lab-equipment', 'abbott', 'i-STAT', 'istat', ARRAY[]::TEXT[], ARRAY['istat']::TEXT[], 2),
  ('lab-equipment', 'roche', 'Cobas c 111', 'cobasc111', ARRAY[]::TEXT[], ARRAY['cobasc111']::TEXT[], 0),
  ('lab-equipment', 'roche', 'Cobas e 411', 'cobase411', ARRAY[]::TEXT[], ARRAY['cobase411']::TEXT[], 1),
  ('lab-equipment', 'roche', 'Cobas b 121', 'cobasb121', ARRAY[]::TEXT[], ARRAY['cobasb121']::TEXT[], 2),
  ('lab-equipment', 'beckmancoulter', 'DxH 500', 'dxh500', ARRAY[]::TEXT[], ARRAY['dxh500']::TEXT[], 0),
  ('lab-equipment', 'beckmancoulter', 'AU480', 'au480', ARRAY[]::TEXT[], ARRAY['au480']::TEXT[], 1),
  ('lab-equipment', 'beckmancoulter', 'Access 2', 'access2', ARRAY[]::TEXT[], ARRAY['access2']::TEXT[], 2),
  ('lab-equipment', 'thermofisherscientific', 'Multiskan FC', 'multiskanfc', ARRAY[]::TEXT[], ARRAY['multiskanfc']::TEXT[], 0),
  ('lab-equipment', 'thermofisherscientific', 'Heraeus Megafuge 8', 'heraeusmegafuge8', ARRAY[]::TEXT[], ARRAY['heraeusmegafuge8']::TEXT[], 1),
  ('lab-equipment', 'eppendorf', 'Centrifuge 5424', 'centrifuge5424', ARRAY['5424']::TEXT[], ARRAY['centrifuge5424', '5424']::TEXT[], 0),
  ('lab-equipment', 'eppendorf', 'Centrifuge 5702', 'centrifuge5702', ARRAY['5702']::TEXT[], ARRAY['centrifuge5702', '5702']::TEXT[], 1),
  ('lab-equipment', 'hettich', 'EBA 200', 'eba200', ARRAY[]::TEXT[], ARRAY['eba200']::TEXT[], 0),
  ('lab-equipment', 'hettich', 'Rotofix 32 A', 'rotofix32a', ARRAY[]::TEXT[], ARRAY['rotofix32a']::TEXT[], 1),
  ('lab-equipment', 'hettich', 'Mikro 220', 'mikro220', ARRAY[]::TEXT[], ARRAY['mikro220']::TEXT[], 2),
  ('lab-equipment', 'rayto', 'RT-9200', 'rt9200', ARRAY[]::TEXT[], ARRAY['rt9200']::TEXT[], 0),
  ('lab-equipment', 'rayto', 'RT-7600', 'rt7600', ARRAY[]::TEXT[], ARRAY['rt7600']::TEXT[], 1),
  ('lab-equipment', 'dirui', 'H-500', 'h500', ARRAY[]::TEXT[], ARRAY['h500']::TEXT[], 0),
  ('lab-equipment', 'dirui', 'BCC-3000B', 'bcc3000b', ARRAY[]::TEXT[], ARRAY['bcc3000b']::TEXT[], 1)
) AS v("category", "brand", "name", "name_key", "aliases", "match_keys", "position")
JOIN "classified_brands" b ON b."name_key" = v."brand"
JOIN "classified_categories" c ON c."slug" = v."category"
ON CONFLICT DO NOTHING;

-- What may never be sold here: used or opened single-use items are refused outright; prescription medicines go to a moderator.
INSERT INTO "classified_prohibited_words" ("id", "phrase", "action")
SELECT gen_random_uuid(), p, 'block' FROM unnest(ARRAY['used syringe', 'used syringes', 'used needle', 'used needles', 'used catheter', 'used catheters', 'used test strips']) AS p
ON CONFLICT DO NOTHING;
INSERT INTO "classified_prohibited_words" ("id", "phrase", "action")
SELECT gen_random_uuid(), p, 'review' FROM unnest(ARRAY['prescription only', 'prescription medicine', 'prescription drug', 'prescription drugs']) AS p
ON CONFLICT DO NOTHING;
