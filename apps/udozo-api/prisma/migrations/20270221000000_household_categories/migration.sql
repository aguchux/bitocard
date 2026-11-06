-- Categories rescanned (6 November 2026, the owner's request): what people sell that had no place of its own, and
-- search words for every subcategory, so a seller or buyer typing "carpet", "plastic chairs" or "cups" finds the
-- right one. New subcategories, each in its natural top category:
--   Home and living: Plastic chairs and tables, Mattresses and bedding, Carpets, rugs and curtains, Plates, cups and
--   dinnerware (ceramic, glass, melamine; split from Cookware and tableware, now Pots, pans and cookers), Plastics and
--   storage (buckets, bowls, containers, drums, coolers).
--   Fashion: Fabrics and textiles (Ankara, lace, aso-oke, kente). Building and tools: Tiles and sanitary ware.
--   Sports and hobbies: Stationery and school supplies. Wholesale and business: Packaging materials.
--   Services: Tailoring and fashion design, Building and construction.
-- Fridges, freezers and washing machines becomes Fridges, ACs and washing machines (air conditioners were already
-- listed there). Slugs never change; listings stay where they are.

ALTER TABLE "classified_categories" ADD COLUMN "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[];

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

-- The new subcategories, one at a time so each takes its own free prefix.
CREATE OR REPLACE FUNCTION pg_temp.udz_add_category(parent_slug TEXT, new_slug TEXT, new_name TEXT, new_icon TEXT, wished TEXT[]) RETURNS VOID AS $$
BEGIN
  -- A subcategory follows its top category's business flag (Packaging materials is for businesses).
  INSERT INTO "classified_categories" ("id", "parent_id", "slug", "name", "icon", "position", "b2b", "enabled", "sku_prefix", "updated_at")
  SELECT gen_random_uuid(), p."id", new_slug, new_name, new_icon, 99, p."b2b", true, pg_temp.udz_free_prefix(wished), CURRENT_TIMESTAMP
  FROM "classified_categories" p WHERE p."slug" = parent_slug
  ON CONFLICT ("slug") DO NOTHING;
  INSERT INTO "classified_category_sku_prefixes" ("prefix", "category_id")
  SELECT "sku_prefix", "id" FROM "classified_categories" WHERE "slug" = new_slug
  ON CONFLICT ("prefix") DO NOTHING;
  -- Open wherever its top category is, as it is there.
  INSERT INTO "classified_category_countries" ("category_id", "country", "enabled")
  SELECT c."id", pc."country", pc."enabled"
  FROM "classified_category_countries" pc
  JOIN "classified_categories" p ON p."id" = pc."category_id" AND p."slug" = parent_slug
  CROSS JOIN "classified_categories" c
  WHERE c."slug" = new_slug
  ON CONFLICT ("category_id", "country") DO NOTHING;
END;
$$ LANGUAGE plpgsql;

SELECT pg_temp.udz_add_category('home-garden', 'plastic-furniture', 'Plastic chairs and tables', 'table', ARRAY['PLF', 'PCT', 'CHR']);
SELECT pg_temp.udz_add_category('home-garden', 'bedding-mattresses', 'Mattresses and bedding', 'bed-double', ARRAY['MAT', 'MTB', 'BED']);
SELECT pg_temp.udz_add_category('home-garden', 'carpets-rugs', 'Carpets, rugs and curtains', 'blinds', ARRAY['CRP', 'RUG', 'CTN']);
SELECT pg_temp.udz_add_category('home-garden', 'tableware', 'Plates, cups and dinnerware', 'coffee', ARRAY['TBW', 'PLT', 'DIN']);
SELECT pg_temp.udz_add_category('home-garden', 'plastics-storage', 'Plastics and storage', 'package-open', ARRAY['PLS', 'STR', 'PST']);
SELECT pg_temp.udz_add_category('fashion', 'fabrics', 'Fabrics and textiles', 'spool', ARRAY['FAB', 'TXT', 'FBR']);
SELECT pg_temp.udz_add_category('repair-construction', 'tiles-sanitary', 'Tiles and sanitary ware', 'bath', ARRAY['TIL', 'SAN', 'TSW']);
SELECT pg_temp.udz_add_category('sports-leisure', 'stationery', 'Stationery and school supplies', 'pencil-ruler', ARRAY['STN', 'STA', 'SCH']);
SELECT pg_temp.udz_add_category('business-industrial', 'packaging', 'Packaging materials', 'package-2', ARRAY['PKG', 'PAK', 'PCK']);
SELECT pg_temp.udz_add_category('services', 'tailoring', 'Tailoring and fashion design', 'ruler', ARRAY['TLR', 'TAI', 'FDS']);
SELECT pg_temp.udz_add_category('services', 'construction-services', 'Building and construction', 'hard-hat', ARRAY['CNS', 'CON', 'BLS']);

DROP FUNCTION pg_temp.udz_add_category(TEXT, TEXT, TEXT, TEXT, TEXT[]);
DROP FUNCTION pg_temp.udz_free_prefix(TEXT[]);

-- Clearer names where the old one hid what is there.
UPDATE "classified_categories" SET "name" = 'Fridges, ACs and washing machines', "updated_at" = CURRENT_TIMESTAMP WHERE "slug" = 'home-appliances';
UPDATE "classified_categories" SET "name" = 'Pots, pans and cookers', "icon" = 'cooking-pot', "updated_at" = CURRENT_TIMESTAMP WHERE "slug" = 'kitchen';

-- Each list in the order a shopper looks for things (an absent slug changes nothing).
UPDATE "classified_categories" AS c SET "position" = v."position", "updated_at" = CURRENT_TIMESTAMP FROM (VALUES
  ('furniture', 0), ('plastic-furniture', 1), ('bedding-mattresses', 2), ('carpets-rugs', 3), ('home-appliances', 4),
  ('kitchen-appliances', 5), ('kitchen', 6), ('tableware', 7), ('plastics-storage', 8), ('home-accessories', 9),
  ('household-supplies', 10), ('generators-solar', 11), ('garden', 12),
  ('clothing', 0), ('wedding-wear', 1), ('fabrics', 2), ('shoes', 3), ('bags', 4), ('jewellery-watches', 5), ('clothing-accessories', 6),
  ('building-materials', 0), ('tiles-sanitary', 1), ('tools', 2), ('plumbing-electrical', 3), ('doors-windows', 4),
  ('fitness', 0), ('sports-equipment', 1), ('bicycles', 2), ('musical-instruments', 3), ('books', 4), ('stationery', 5), ('arts-crafts', 6),
  ('wholesale', 0), ('packaging', 1), ('industrial-machinery', 2), ('office-equipment', 3), ('restaurant-equipment', 4), ('retail-equipment', 5), ('salon-equipment', 6),
  ('repair-services', 0), ('construction-services', 1), ('cleaning', 2), ('events', 3), ('beauty-services', 4), ('tailoring', 5),
  ('lessons', 6), ('it-services', 7), ('photography-video', 8), ('logistics', 9), ('car-services', 10)
) AS v("slug", "position") WHERE c."slug" = v."slug";

-- Features the new categories need that the registry lacked.
INSERT INTO "classified_features" ("id", "key", "name", "icon", "data_type", "unit", "choices", "default_value", "placeholder", "min", "max", "synonyms", "filterable", "updated_at") VALUES
  (gen_random_uuid(), 'tableware_material', 'Made of', 'layers', 'choice', NULL, ARRAY['Ceramic', 'Porcelain', 'Bone china', 'Glass', 'Melamine', 'Plastic', 'Stainless steel', 'Enamel', 'Wood or bamboo', 'Clay']::TEXT[], NULL, NULL, NULL, NULL, ARRAY['ceramic', 'porcelain', 'glass', 'melamine', 'plastic', 'material']::TEXT[], true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'pieces', 'Pieces in the set', 'layout-grid', 'number', NULL, ARRAY[]::TEXT[], NULL, 'e.g. 24', 1, 10000, ARRAY['pieces', 'pcs', 'set of', 'piece set']::TEXT[], true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'fabric_type', 'Fabric', 'spool', 'choice', NULL, ARRAY['Ankara', 'Lace', 'Aso-oke', 'Kente', 'Adire', 'Guinea brocade', 'George', 'Chiffon', 'Cotton', 'Linen', 'Silk', 'Satin', 'Wool', 'Velvet', 'Denim', 'Other']::TEXT[], NULL, NULL, NULL, NULL, ARRAY['ankara', 'lace', 'aso oke', 'kente', 'wax print', 'material']::TEXT[], true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'fabric_length', 'Length', 'ruler', 'number', 'yards', ARRAY[]::TEXT[], NULL, 'e.g. 6', 1, 100000, ARRAY['yards', 'yard', 'metres', 'length']::TEXT[], true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- What each new subcategory suggests, in order; `filter` only where the key is filterable.
INSERT INTO "classified_category_features" ("category_id", "feature_id", "position", "filter", "placeholder")
SELECT c."id", f."id", v."position", v."filter" AND f."filterable", v."placeholder" FROM (VALUES
  ('plastic-furniture', 'type', 0, false, 'e.g. armless chair, table, stool, chair and table set'),
  ('plastic-furniture', 'colour', 1, true, NULL),
  ('plastic-furniture', 'pieces', 2, true, 'e.g. 4 chairs and a table is 5'),
  ('plastic-furniture', 'max_weight', 3, false, NULL),
  ('plastic-furniture', 'foldable', 4, true, NULL),
  ('plastic-furniture', 'setting', 5, true, NULL),
  ('plastic-furniture', 'material', 6, false, 'e.g. plastic, rattan-look, resin'),
  ('plastic-furniture', 'quantity_available', 7, false, NULL),
  ('plastic-furniture', 'min_order', 8, false, NULL),
  ('bedding-mattresses', 'type', 0, false, 'e.g. mattress, bedsheet set, duvet, pillow, towel'),
  ('bedding-mattresses', 'brand', 1, true, NULL),
  ('bedding-mattresses', 'size', 2, false, 'e.g. 6 by 6 feet'),
  ('bedding-mattresses', 'thickness', 3, false, 'e.g. 250 (10 inches)'),
  ('bedding-mattresses', 'material', 4, false, 'e.g. orthopaedic foam, spring, cotton'),
  ('bedding-mattresses', 'colour', 5, true, NULL),
  ('bedding-mattresses', 'pieces', 6, false, NULL),
  ('bedding-mattresses', 'sealed', 7, true, NULL),
  ('bedding-mattresses', 'warranty', 8, false, NULL),
  ('carpets-rugs', 'type', 0, false, 'e.g. rug, wall-to-wall carpet, runner, curtains, blinds, door mat'),
  ('carpets-rugs', 'size', 1, false, 'e.g. 5 by 7 feet, or 4 metres wide'),
  ('carpets-rugs', 'colour', 2, true, NULL),
  ('carpets-rugs', 'material', 3, false, 'e.g. shaggy, wool, polyester, Persian'),
  ('carpets-rugs', 'pieces', 4, false, 'e.g. curtain panels'),
  ('carpets-rugs', 'installation', 5, true, NULL),
  ('carpets-rugs', 'dimensions', 6, false, NULL),
  ('tableware', 'type', 0, false, 'e.g. dinner set, plates, cups, mugs, glasses, cutlery, flask'),
  ('tableware', 'tableware_material', 1, true, NULL),
  ('tableware', 'pieces', 2, true, NULL),
  ('tableware', 'brand', 3, true, NULL),
  ('tableware', 'colour', 4, true, NULL),
  ('tableware', 'volume', 5, false, 'e.g. 350 for a mug'),
  ('tableware', 'units_per_pack', 6, false, NULL),
  ('tableware', 'sealed', 7, true, NULL),
  ('plastics-storage', 'type', 0, false, 'e.g. bucket, bowl, food container, drum, laundry basket, cooler'),
  ('plastics-storage', 'brand', 1, true, NULL),
  ('plastics-storage', 'capacity', 2, false, NULL),
  ('plastics-storage', 'colour', 3, true, NULL),
  ('plastics-storage', 'pieces', 4, false, NULL),
  ('plastics-storage', 'units_per_pack', 5, false, NULL),
  ('plastics-storage', 'min_order', 6, false, NULL),
  ('fabrics', 'fabric_type', 0, true, NULL),
  ('fabrics', 'colour', 1, true, NULL),
  ('fabrics', 'fabric_length', 2, true, NULL),
  ('fabrics', 'brand', 3, true, NULL),
  ('fabrics', 'material', 4, false, 'e.g. 100% cotton, Swiss voile'),
  ('fabrics', 'occasion', 5, true, NULL),
  ('fabrics', 'quantity_available', 6, false, 'e.g. 40 pieces of 6 yards'),
  ('fabrics', 'min_order', 7, false, NULL),
  ('fabrics', 'country_of_origin', 8, false, NULL),
  ('tiles-sanitary', 'type', 0, false, 'e.g. floor tiles, wall tiles, WC, wash hand basin, shower, kitchen sink'),
  ('tiles-sanitary', 'brand', 1, true, NULL),
  ('tiles-sanitary', 'size', 2, false, 'e.g. 60 by 60 cm'),
  ('tiles-sanitary', 'colour', 3, true, NULL),
  ('tiles-sanitary', 'material', 4, false, 'e.g. porcelain, ceramic, granite, marble'),
  ('tiles-sanitary', 'units_per_pack', 5, false, 'e.g. tiles per carton'),
  ('tiles-sanitary', 'quantity_available', 6, false, NULL),
  ('tiles-sanitary', 'country_of_origin', 7, false, NULL),
  ('tiles-sanitary', 'installation', 8, true, NULL),
  ('stationery', 'type', 0, false, 'e.g. exercise books, pens, school bag, calculator, files'),
  ('stationery', 'brand', 1, true, NULL),
  ('stationery', 'education_level', 2, true, NULL),
  ('stationery', 'pack_size', 3, false, NULL),
  ('stationery', 'units_per_pack', 4, false, NULL),
  ('stationery', 'colour', 5, false, NULL),
  ('stationery', 'min_order', 6, false, NULL),
  ('packaging', 'type', 0, false, 'e.g. nylon bags, cartons, plastic bottles, food packs, jars'),
  ('packaging', 'material', 1, false, 'e.g. PET, paper, foil, glass'),
  ('packaging', 'size', 2, false, 'e.g. 50 cl, 30 by 40 cm'),
  ('packaging', 'units_per_pack', 3, false, NULL),
  ('packaging', 'min_order', 4, false, NULL),
  ('packaging', 'quantity_available', 5, false, NULL),
  ('packaging', 'country_of_origin', 6, true, NULL),
  ('packaging', 'lead_time', 7, false, 'e.g. 5 days with your print'),
  ('packaging', 'invoice_available', 8, true, NULL),
  ('tailoring', 'type', 0, false, 'e.g. native wear, suits, bridal, alterations, school uniforms'),
  ('tailoring', 'gender', 1, true, NULL),
  ('tailoring', 'pricing', 2, true, NULL),
  ('tailoring', 'home_service', 3, true, NULL),
  ('tailoring', 'experience', 4, true, NULL),
  ('tailoring', 'lead_time', 5, false, 'e.g. ready in 7 days'),
  ('tailoring', 'availability', 6, false, NULL),
  ('tailoring', 'certified', 7, true, NULL),
  ('construction-services', 'type', 0, false, 'e.g. bricklaying, POP ceilings, tiling, painting, roofing, wiring'),
  ('construction-services', 'pricing', 1, true, NULL),
  ('construction-services', 'home_service', 2, true, NULL),
  ('construction-services', 'experience', 3, true, NULL),
  ('construction-services', 'certified', 4, true, NULL),
  ('construction-services', 'team_size', 5, false, NULL),
  ('construction-services', 'availability', 6, false, NULL),
  ('construction-services', 'emergency', 7, true, NULL)
) AS v("slug", "key", "position", "filter", "placeholder")
JOIN "classified_categories" c ON c."slug" = v."slug"
JOIN "classified_features" f ON f."key" = v."key"
ON CONFLICT DO NOTHING;

-- Brands these lists need that the registry lacked (an existing name or key is never made twice). Every list that
-- asks for a brand offers at least ten; sellers can still type their own.
INSERT INTO "classified_brands" ("id", "slug", "name", "name_key", "aliases", "match_keys", "logo_file", "color", "updated_at") VALUES
  (gen_random_uuid(), 'vitafoam', 'Vitafoam', 'vitafoam', ARRAY['vita foam']::TEXT[], ARRAY['vitafoam']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'mouka', 'Mouka', 'mouka', ARRAY['mouka foam']::TEXT[], ARRAY['mouka', 'moukafoam']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'winco-foam', 'Winco Foam', 'wincofoam', ARRAY['winco']::TEXT[], ARRAY['wincofoam', 'winco']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'latex-foam', 'Latex Foam', 'latexfoam', ARRAY[]::TEXT[], ARRAY['latexfoam']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'sealy', 'Sealy', 'sealy', ARRAY[]::TEXT[], ARRAY['sealy']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'simmons', 'Simmons', 'simmons', ARRAY[]::TEXT[], ARRAY['simmons']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'serta', 'Serta', 'serta', ARRAY[]::TEXT[], ARRAY['serta']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'tempur', 'Tempur', 'tempur', ARRAY['tempur-pedic']::TEXT[], ARRAY['tempur', 'tempurpedic']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'dunlopillo', 'Dunlopillo', 'dunlopillo', ARRAY[]::TEXT[], ARRAY['dunlopillo']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'slumberland', 'Slumberland', 'slumberland', ARRAY[]::TEXT[], ARRAY['slumberland']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'kenpoly', 'Kenpoly', 'kenpoly', ARRAY[]::TEXT[], ARRAY['kenpoly']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'curver', 'Curver', 'curver', ARRAY[]::TEXT[], ARRAY['curver']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'sistema', 'Sistema', 'sistema', ARRAY[]::TEXT[], ARRAY['sistema']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'keter', 'Keter', 'keter', ARRAY[]::TEXT[], ARRAY['keter']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'rubbermaid', 'Rubbermaid', 'rubbermaid', ARRAY[]::TEXT[], ARRAY['rubbermaid']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'cello', 'Cello', 'cello', ARRAY[]::TEXT[], ARRAY['cello']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'milton', 'Milton', 'milton', ARRAY[]::TEXT[], ARRAY['milton']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'igloo', 'Igloo', 'igloo', ARRAY[]::TEXT[], ARRAY['igloo']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'thermos', 'Thermos', 'thermos', ARRAY[]::TEXT[], ARRAY['thermos']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'noritake', 'Noritake', 'noritake', ARRAY[]::TEXT[], ARRAY['noritake']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'villeroy-and-boch', 'Villeroy & Boch', 'villeroyboch', ARRAY['villeroy and boch', 'villeroy']::TEXT[], ARRAY['villeroyboch', 'villeroyandboch', 'villeroy']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'toto', 'TOTO', 'toto', ARRAY[]::TEXT[], ARRAY['toto']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'duravit', 'Duravit', 'duravit', ARRAY[]::TEXT[], ARRAY['duravit']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'hansgrohe', 'Hansgrohe', 'hansgrohe', ARRAY[]::TEXT[], ARRAY['hansgrohe']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'rak-ceramics', 'RAK Ceramics', 'rakceramics', ARRAY['rak']::TEXT[], ARRAY['rakceramics', 'rak']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'porcelanosa', 'Porcelanosa', 'porcelanosa', ARRAY[]::TEXT[], ARRAY['porcelanosa']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'pilot', 'Pilot', 'pilot', ARRAY[]::TEXT[], ARRAY['pilot']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'parker', 'Parker', 'parker', ARRAY[]::TEXT[], ARRAY['parker']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'vlisco', 'Vlisco', 'vlisco', ARRAY['hollandais', 'dutch wax']::TEXT[], ARRAY['vlisco', 'hollandais', 'dutchwax']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'gtp', 'GTP', 'gtp', ARRAY['ghana textiles printing']::TEXT[], ARRAY['gtp', 'ghanatextilesprinting']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'woodin', 'Woodin', 'woodin', ARRAY[]::TEXT[], ARRAY['woodin']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'atl', 'ATL', 'atl', ARRAY['akosombo textiles']::TEXT[], ARRAY['atl', 'akosombotextiles']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'hitarget', 'Hitarget', 'hitarget', ARRAY['hi-target']::TEXT[], ARRAY['hitarget']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'abc-wax', 'ABC Wax', 'abcwax', ARRAY[]::TEXT[], ARRAY['abcwax']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'uniwax', 'Uniwax', 'uniwax', ARRAY[]::TEXT[], ARRAY['uniwax']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'da-viva', 'Da Viva', 'daviva', ARRAY[]::TEXT[], ARRAY['daviva']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'sotiba', 'Sotiba', 'sotiba', ARRAY[]::TEXT[], ARRAY['sotiba']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'printex', 'Printex', 'printex', ARRAY[]::TEXT[], ARRAY['printex']::TEXT[], NULL, NULL, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- Each new list's brands, most bought first; brands already in the registry are linked.
INSERT INTO "classified_brand_categories" ("brand_id", "category_id", "position")
SELECT b."id", c."id", u."position" - 1 FROM (VALUES
  ('bedding-mattresses', ARRAY['vitafoam', 'mouka', 'wincofoam', 'latexfoam', 'sealy', 'simmons', 'serta', 'tempur', 'dunlopillo', 'slumberland']::TEXT[]),
  ('tableware', ARRAY['royalford', 'luminarc', 'corelle', 'pyrex', 'arcopal', 'bormiolirocco', 'cello', 'milton', 'thermos', 'noritake', 'villeroyboch']::TEXT[]),
  ('plastics-storage', ARRAY['tupperware', 'locklock', 'royalford', 'kenpoly', 'cello', 'milton', 'curver', 'sistema', 'keter', 'rubbermaid', 'igloo']::TEXT[]),
  ('fabrics', ARRAY['vlisco', 'gtp', 'woodin', 'atl', 'hitarget', 'abcwax', 'uniwax', 'daviva', 'sotiba', 'printex']::TEXT[]),
  ('tiles-sanitary', ARRAY['twyford', 'grohe', 'idealstandard', 'americanstandard', 'roca', 'kohler', 'toto', 'duravit', 'hansgrohe', 'rakceramics', 'porcelanosa', 'villeroyboch']::TEXT[]),
  ('stationery', ARRAY['bic', 'fabercastell', 'staedtler', 'pelikan', 'maped', 'crayola', 'casio', 'deli', 'pilot', 'parker']::TEXT[])
) AS v("slug", "brands")
CROSS JOIN LATERAL unnest(v."brands") WITH ORDINALITY AS u("brand", "position")
JOIN "classified_brands" b ON b."name_key" = u."brand"
JOIN "classified_categories" c ON c."slug" = v."slug"
ON CONFLICT DO NOTHING;

-- What to check before paying, where the top category's list does not cover it.
UPDATE "classified_categories" AS c SET "safety_checklist" = v."checks", "updated_at" = CURRENT_TIMESTAMP FROM (VALUES
  ('plastic-furniture', ARRAY['Sit on a chair and check the legs do not bend, crack or wobble', 'Count the chairs and tables, and check they are the colour and design you agreed', 'For a big order, check a few from different stacks, not only the top one']::TEXT[]),
  ('bedding-mattresses', ARRAY['Measure the mattress in front of you: its size and thickness, as you were told', 'On a new mattress, look for the maker''s label and wrapping that has not been opened', 'Press it all over for lumps or sagging, and check for stains, damp or smells']::TEXT[]),
  ('carpets-rugs', ARRAY['Unroll it and measure it in front of you', 'Check the back and edges for wear, stains, damp and moth damage', 'For curtains, count the panels and check the hooks or rings are there']::TEXT[]),
  ('tableware', ARRAY['Count the pieces against the set''s list', 'Check every piece for chips, cracks and crazing in the glaze', 'Ask whether it can go in the microwave or dishwasher before you rely on it']::TEXT[]),
  ('fabrics', ARRAY['Measure the yards in front of you before paying', 'Look at the colour and pattern in daylight, and check the whole length for flaws and fading', 'For wax prints, check the selvedge carries the maker''s name if it is sold as theirs']::TEXT[]),
  ('tiles-sanitary', ARRAY['Count the cartons, and check the batch and shade numbers match on every one', 'Open a carton or two and check the tiles for chips, cracks and warping', 'Check toilets and basins for cracks, and that every fitting is in the box']::TEXT[])
) AS v("slug", "checks") WHERE c."slug" = v."slug";

-- Search words for every subcategory: what people call the things sold there. Matched as typed (singular is enough:
-- "plastic chairs" contains "plastic chair"), on Post an ad, in the search box's suggestions and by the assistants.
UPDATE "classified_categories" AS c SET "keywords" = v."words", "updated_at" = CURRENT_TIMESTAMP FROM (VALUES
  ('mobile-phones', ARRAY['phone', 'smartphone', 'iphone', 'android', 'samsung', 'tecno', 'infinix', 'itel', 'button phone', 'feature phone', 'cell phone', 'mobile']::TEXT[]),
  ('tablets', ARRAY['tablet', 'ipad', 'tab', 'e-reader', 'kindle', 'kids tablet']::TEXT[]),
  ('smart-watches', ARRAY['smartwatch', 'smart watch', 'apple watch', 'fitness band', 'fitness tracker', 'smart band']::TEXT[]),
  ('phone-accessories', ARRAY['charger', 'phone case', 'power bank', 'screen protector', 'cable', 'usb', 'earpiece', 'phone holder', 'memory card', 'sim tray', 'pouch']::TEXT[]),
  ('laptops', ARRAY['laptop', 'notebook', 'macbook', 'chromebook', 'computer', 'hp', 'dell', 'lenovo']::TEXT[]),
  ('desktops', ARRAY['desktop', 'monitor', 'system unit', 'cpu', 'all in one', 'imac', 'pc', 'computer screen']::TEXT[]),
  ('computer-accessories', ARRAY['keyboard', 'mouse', 'ram', 'hard drive', 'ssd', 'flash drive', 'graphics card', 'ups', 'webcam', 'laptop bag', 'laptop charger', 'motherboard']::TEXT[]),
  ('printers', ARRAY['printer', 'scanner', 'photocopier', 'toner', 'ink', 'cartridge', 'plotter', 'label printer']::TEXT[]),
  ('tvs', ARRAY['tv', 'television', 'smart tv', 'home theatre', 'home theater', 'projector', 'decoder', 'soundbar', 'tv stand', 'tv bracket']::TEXT[]),
  ('audio', ARRAY['speaker', 'sound system', 'amplifier', 'bluetooth speaker', 'woofer', 'microphone', 'mixer', 'radio', 'public address']::TEXT[]),
  ('headphones', ARRAY['headphone', 'earbud', 'earphone', 'airpod', 'headset', 'neckband']::TEXT[]),
  ('cameras', ARRAY['camera', 'dslr', 'mirrorless', 'drone', 'lens', 'tripod', 'gopro', 'camcorder', 'ring light']::TEXT[]),
  ('video-games', ARRAY['playstation', 'ps5', 'ps4', 'xbox', 'nintendo', 'game console', 'video game', 'game pad', 'controller', 'fifa']::TEXT[]),
  ('security-surveillance', ARRAY['cctv', 'security camera', 'dvr', 'nvr', 'doorbell camera', 'alarm', 'smart lock', 'intercom', 'access control', 'smart home']::TEXT[]),
  ('networking', ARRAY['router', 'mifi', 'modem', 'wifi', 'access point', 'switch', 'network cable', 'starlink', 'antenna', 'extender']::TEXT[]),
  ('cars', ARRAY['car', 'toyota', 'honda', 'lexus', 'benz', 'tokunbo', 'saloon', 'suv', 'jeep', 'pickup', 'corolla', 'camry']::TEXT[]),
  ('motorcycles', ARRAY['motorcycle', 'motorbike', 'okada', 'boda boda', 'scooter', 'keke', 'tricycle', 'bajaj', 'power bike']::TEXT[]),
  ('buses', ARRAY['bus', 'van', 'hiace', 'sienna', 'minibus', 'danfo', 'coaster', 'matatu']::TEXT[]),
  ('trucks-buses', ARRAY['truck', 'trailer', 'tipper', 'lorry', 'tanker', 'mack', 'dyna', 'canter', 'flatbed']::TEXT[]),
  ('heavy-equipment', ARRAY['excavator', 'bulldozer', 'forklift', 'crane', 'grader', 'backhoe', 'payloader', 'roller', 'caterpillar']::TEXT[]),
  ('vehicle-parts', ARRAY['tyre', 'tire', 'engine', 'gearbox', 'battery', 'headlamp', 'bumper', 'rim', 'brake pad', 'spare part', 'car stereo', 'car mat', 'shock absorber']::TEXT[]),
  ('houses-for-rent', ARRAY['house for rent', 'flat', 'apartment', 'self contain', 'mini flat', 'room and parlour', 'duplex', 'bungalow', 'rent', 'to let']::TEXT[]),
  ('houses-for-sale', ARRAY['house for sale', 'duplex', 'bungalow', 'terrace', 'flat for sale', 'apartment for sale', 'buy house']::TEXT[]),
  ('short-let', ARRAY['short let', 'shortlet', 'airbnb', 'serviced apartment', 'holiday home', 'guest house', 'lodge', 'per night']::TEXT[]),
  ('land', ARRAY['land', 'plot', 'acre', 'hectare', 'farmland', 'c of o']::TEXT[]),
  ('commercial-property', ARRAY['shop', 'office', 'warehouse', 'store', 'plaza', 'office space', 'kiosk', 'container shop', 'factory']::TEXT[]),
  ('event-venues', ARRAY['hall', 'event centre', 'event center', 'venue', 'banquet', 'garden venue', 'conference room']::TEXT[]),
  ('furniture', ARRAY['sofa', 'couch', 'bed frame', 'wardrobe', 'dining table', 'dining set', 'chair', 'table', 'cupboard', 'shelf', 'tv stand', 'office chair', 'center table', 'bunk bed', 'dressing mirror', 'shoe rack']::TEXT[]),
  ('plastic-furniture', ARRAY['plastic chair', 'plastic table', 'plastic stool', 'monobloc', 'armless chair', 'arm chair', 'party chair', 'event chair', 'garden chair', 'outdoor chair', 'outdoor table', 'chair and table set', 'kids plastic chair', 'folding chair']::TEXT[]),
  ('bedding-mattresses', ARRAY['mattress', 'foam', 'spring mattress', 'orthopaedic', 'orthopedic', 'bedsheet', 'bed sheet', 'duvet', 'pillow', 'pillowcase', 'blanket', 'towel', 'bedspread', 'mosquito net', 'mattress protector']::TEXT[]),
  ('carpets-rugs', ARRAY['carpet', 'rug', 'shaggy rug', 'persian rug', 'runner', 'rug mat', 'door mat', 'floor mat', 'prayer mat', 'rubber carpet', 'curtain', 'blind', 'window blind', 'curtain rod', 'center rug']::TEXT[]),
  ('home-appliances', ARRAY['fridge', 'refrigerator', 'freezer', 'chest freezer', 'deep freezer', 'washing machine', 'air conditioner', 'ac', 'split unit', 'standing ac', 'water dispenser', 'standing fan', 'ceiling fan', 'fan', 'dryer', 'dishwasher', 'cooker']::TEXT[]),
  ('kitchen-appliances', ARRAY['blender', 'microwave', 'toaster', 'kettle', 'air fryer', 'rice cooker', 'juicer', 'mixer', 'food processor', 'electric cooker', 'hot plate', 'sandwich maker', 'iron', 'pressing iron', 'vacuum cleaner']::TEXT[]),
  ('kitchen', ARRAY['pot', 'pan', 'frying pan', 'non stick', 'pressure cooker', 'cookware', 'gas cooker', 'gas burner', 'stove', 'gas cylinder', 'knife', 'chopping board', 'grater', 'mortar', 'cooking utensil', 'baking pan', 'oven tray']::TEXT[]),
  ('tableware', ARRAY['plate', 'cup', 'mug', 'dinner set', 'dinnerware', 'ceramic', 'porcelain', 'glass cup', 'drinking glass', 'wine glass', 'tea set', 'cutlery', 'spoon', 'fork', 'serving dish', 'bowl', 'tray', 'flask', 'food flask', 'jug', 'melamine']::TEXT[]),
  ('plastics-storage', ARRAY['plastic', 'plastics', 'bucket', 'basin', 'plastic bowl', 'food container', 'storage box', 'container', 'drum', 'jerrycan', 'jerry can', 'laundry basket', 'basket', 'cooler', 'ice chest', 'waste bin', 'dustbin', 'plastic rack', 'shoe box', 'kitchen rack']::TEXT[]),
  ('home-accessories', ARRAY['decor', 'wall clock', 'mirror', 'frame', 'painting', 'vase', 'flower', 'artificial flower', 'lamp', 'chandelier', 'bulb', 'light', 'led strip', 'candle', 'wall art', 'wallpaper', 'cushion']::TEXT[]),
  ('household-supplies', ARRAY['detergent', 'soap', 'bleach', 'disinfectant', 'insecticide', 'mop', 'broom', 'toilet roll', 'tissue', 'air freshener', 'cleaning', 'dish wash', 'sponge']::TEXT[]),
  ('generators-solar', ARRAY['generator', 'gen', 'inverter', 'solar panel', 'solar', 'battery', 'lithium battery', 'charge controller', 'stabiliser', 'stabilizer', 'ups', 'power station', 'solar light']::TEXT[]),
  ('garden', ARRAY['garden', 'plant', 'flower pot', 'lawn mower', 'hose', 'artificial grass', 'outdoor', 'swing', 'canopy', 'umbrella', 'barbecue', 'grill', 'water tank']::TEXT[]),
  ('clothing', ARRAY['shirt', 'dress', 'gown', 'trouser', 'jeans', 't-shirt', 'top', 'skirt', 'suit', 'jacket', 'hoodie', 'underwear', 'bra', 'nightwear', 'jersey', 'shorts', 'joggers']::TEXT[]),
  ('wedding-wear', ARRAY['agbada', 'kaftan', 'senator', 'native', 'buba', 'iro', 'wrapper', 'kente cloth', 'wedding dress', 'bridal', 'aso ebi', 'traditional', 'dashiki', 'kitenge']::TEXT[]),
  ('fabrics', ARRAY['fabric', 'ankara', 'lace', 'aso oke', 'aso-oke', 'kente', 'adire', 'wax print', 'george', 'guinea brocade', 'material', 'textile', 'yard', 'chiffon', 'voile', 'hollandais', 'kitenge fabric', 'upholstery fabric']::TEXT[]),
  ('shoes', ARRAY['shoe', 'sneaker', 'trainer', 'sandal', 'slipper', 'heel', 'boot', 'loafer', 'palm slipper', 'slides', 'canvas']::TEXT[]),
  ('bags', ARRAY['bag', 'handbag', 'backpack', 'purse', 'wallet', 'travel bag', 'luggage', 'suitcase', 'box bag', 'tote']::TEXT[]),
  ('jewellery-watches', ARRAY['jewellery', 'jewelry', 'necklace', 'ring', 'earring', 'bracelet', 'watch', 'gold', 'silver', 'chain', 'beads', 'anklet']::TEXT[]),
  ('clothing-accessories', ARRAY['belt', 'cap', 'hat', 'sunglasses', 'tie', 'scarf', 'gele', 'head tie', 'socks', 'gloves', 'cufflink', 'face cap']::TEXT[]),
  ('skin-care', ARRAY['cream', 'lotion', 'body cream', 'soap', 'serum', 'sunscreen', 'face wash', 'shea butter', 'body oil', 'deodorant', 'toothpaste', 'shaving']::TEXT[]),
  ('hair-beauty', ARRAY['wig', 'hair', 'weave', 'bundle', 'braid', 'attachment', 'extension', 'frontal', 'closure', 'relaxer', 'hair cream', 'clipper', 'hair dryer', 'straightener']::TEXT[]),
  ('makeup', ARRAY['makeup', 'make up', 'lipstick', 'foundation', 'powder', 'eyeliner', 'mascara', 'eyeshadow', 'lashes', 'nail polish', 'brush set', 'concealer']::TEXT[]),
  ('fragrances', ARRAY['perfume', 'fragrance', 'cologne', 'body spray', 'body mist', 'oud', 'perfume oil', 'diffuser']::TEXT[]),
  ('medical-devices', ARRAY['stethoscope', 'blood pressure', 'bp machine', 'sphygmomanometer', 'otoscope', 'ophthalmoscope', 'diagnostic set', 'examination lamp']::TEXT[]),
  ('health-equipment', ARRAY['glucometer', 'thermometer', 'pulse oximeter', 'nebuliser', 'nebulizer', 'weighing scale', 'massager', 'walking stick', 'hearing aid', 'oxygen concentrator']::TEXT[]),
  ('mobility-patient-care', ARRAY['wheelchair', 'walker', 'crutches', 'hospital bed', 'commode', 'patient lift', 'air mattress', 'mobility scooter']::TEXT[]),
  ('clinic-hospital-equipment', ARRAY['patient monitor', 'ecg', 'ultrasound', 'x-ray', 'defibrillator', 'autoclave', 'suction machine', 'theatre light', 'dental chair', 'examination couch', 'infusion pump']::TEXT[]),
  ('lab-equipment', ARRAY['microscope', 'centrifuge', 'analyser', 'analyzer', 'incubator', 'test tube', 'pipette', 'lab', 'laboratory']::TEXT[]),
  ('medical-supplies', ARRAY['gloves', 'face mask', 'syringe', 'cannula', 'bandage', 'gauze', 'plaster', 'ppe', 'scrubs', 'lab coat', 'first aid']::TEXT[]),
  ('baby-gear', ARRAY['pram', 'stroller', 'car seat', 'baby carrier', 'walker', 'high chair', 'bouncer', 'baby bath', 'playpen']::TEXT[]),
  ('baby-care', ARRAY['diaper', 'nappy', 'pampers', 'baby food', 'formula', 'feeding bottle', 'baby wipes', 'breast pump', 'baby lotion', 'sterilizer']::TEXT[]),
  ('kids-clothing', ARRAY['baby clothes', 'kids clothes', 'children clothes', 'school uniform', 'kids shoes', 'romper', 'onesie']::TEXT[]),
  ('kids-furniture', ARRAY['cot', 'crib', 'baby bed', 'kids bed', 'nursery', 'kids table', 'changing table']::TEXT[]),
  ('toys', ARRAY['toy', 'doll', 'lego', 'teddy', 'puzzle', 'board game', 'ride on', 'toy car', 'scooter', 'play set']::TEXT[]),
  ('fitness', ARRAY['treadmill', 'dumbbell', 'gym', 'exercise bike', 'weights', 'barbell', 'bench press', 'yoga mat', 'skipping rope', 'massage gun']::TEXT[]),
  ('sports-equipment', ARRAY['football', 'ball', 'jersey', 'boots', 'basketball', 'tennis', 'table tennis', 'goal post', 'boxing gloves', 'swimming', 'golf']::TEXT[]),
  ('bicycles', ARRAY['bicycle', 'bike', 'cycle', 'mountain bike', 'kids bike', 'e-bike', 'bmx']::TEXT[]),
  ('musical-instruments', ARRAY['guitar', 'keyboard', 'piano', 'drum', 'saxophone', 'violin', 'trumpet', 'talking drum', 'microphone', 'studio']::TEXT[]),
  ('books', ARRAY['book', 'novel', 'textbook', 'past questions', 'bible', 'quran', 'magazine', 'comic', 'storybook']::TEXT[]),
  ('stationery', ARRAY['stationery', 'exercise book', 'notebook', 'pen', 'biro', 'pencil', 'eraser', 'ruler', 'school bag', 'calculator', 'file', 'envelope', 'stapler', 'paper', 'a4 paper', 'printing paper', 'crayon', 'mathematical set', 'diary']::TEXT[]),
  ('arts-crafts', ARRAY['paint', 'canvas', 'easel', 'brush', 'craft', 'beads', 'yarn', 'sewing machine', 'thread', 'glue gun']::TEXT[]),
  ('dogs', ARRAY['dog', 'puppy', 'alsatian', 'german shepherd', 'rottweiler', 'boerboel', 'caucasian', 'pitbull']::TEXT[]),
  ('cats', ARRAY['cat', 'kitten', 'persian cat', 'siamese', 'maine coon', 'british shorthair', 'cat for adoption']::TEXT[]),
  ('birds', ARRAY['parrot', 'bird', 'pigeon', 'lovebird', 'canary', 'african grey']::TEXT[]),
  ('fish', ARRAY['fish', 'aquarium', 'goldfish', 'koi', 'fish tank']::TEXT[]),
  ('pet-accessories', ARRAY['dog food', 'cat food', 'pet food', 'cage', 'kennel', 'leash', 'collar', 'pet bed', 'litter']::TEXT[]),
  ('farm-produce', ARRAY['tomato', 'pepper', 'yam', 'cassava', 'plantain', 'fruit', 'vegetable', 'onion', 'garri', 'maize', 'beans', 'potato']::TEXT[]),
  ('food-drinks', ARRAY['rice', 'beans', 'palm oil', 'groundnut oil', 'flour', 'spices', 'drinks', 'juice', 'wine', 'water', 'snacks', 'noodles', 'cake', 'honey', 'catering']::TEXT[]),
  ('livestock-poultry', ARRAY['goat', 'ram', 'cow', 'chicken', 'broiler', 'layers', 'turkey', 'pig', 'snail', 'catfish', 'rabbit', 'day old chick', 'egg']::TEXT[]),
  ('feeds-seeds', ARRAY['feed', 'poultry feed', 'fish feed', 'seed', 'seedling', 'fertiliser', 'fertilizer', 'manure', 'herbicide', 'pesticide']::TEXT[]),
  ('farm-machinery', ARRAY['tractor', 'sprayer', 'incubator', 'grinding machine', 'milling machine', 'cutlass', 'hoe', 'irrigation', 'water pump', 'harvester']::TEXT[]),
  ('building-materials', ARRAY['cement', 'block', 'sand', 'granite', 'rod', 'iron rod', 'roofing sheet', 'aluminium', 'wood', 'plank', 'paint', 'pop', 'gravel', 'nails', 'interlocking']::TEXT[]),
  ('tiles-sanitary', ARRAY['tile', 'floor tile', 'wall tile', 'ceramic tile', 'porcelain tile', 'granite tile', 'marble', 'toilet', 'wc', 'water closet', 'wash hand basin', 'sink', 'kitchen sink', 'bathtub', 'shower', 'tap', 'sanitary ware', 'mixer tap', 'jacuzzi']::TEXT[]),
  ('tools', ARRAY['drill', 'grinder', 'saw', 'hammer', 'spanner', 'screwdriver', 'welding machine', 'toolbox', 'ladder', 'compressor', 'tool set']::TEXT[]),
  ('plumbing-electrical', ARRAY['pipe', 'pvc pipe', 'cable', 'wire', 'socket', 'switch', 'breaker', 'water pump', 'pumping machine', 'water tank', 'geotank', 'water heater', 'fitting', 'distribution board']::TEXT[]),
  ('doors-windows', ARRAY['door', 'security door', 'window', 'glass', 'burglary proof', 'gate', 'handle', 'lock', 'hinge', 'louvre', 'casement']::TEXT[]),
  ('wholesale', ARRAY['wholesale', 'bulk', 'carton', 'distributor', 'supplier', 'bales', 'thrift', 'okrika', 'stock']::TEXT[]),
  ('packaging', ARRAY['packaging', 'nylon', 'nylon bag', 'carton', 'box', 'plastic bottle', 'pet bottle', 'preform', 'food pack', 'takeaway pack', 'jar', 'label', 'sticker', 'paper bag', 'shrink wrap', 'pouch', 'bubble wrap', 'sack']::TEXT[]),
  ('industrial-machinery', ARRAY['machine', 'production machine', 'water machine', 'sachet machine', 'block machine', 'grinding machine', 'packaging machine', 'printing machine', 'boiler', 'industrial']::TEXT[]),
  ('office-equipment', ARRAY['office chair', 'office desk', 'office table', 'filing cabinet', 'safe', 'whiteboard', 'conference table', 'shredder', 'photocopier']::TEXT[]),
  ('restaurant-equipment', ARRAY['industrial cooker', 'deep fryer', 'oven', 'popcorn machine', 'shawarma machine', 'display fridge', 'chiller', 'griller', 'catering equipment', 'chafing dish']::TEXT[]),
  ('retail-equipment', ARRAY['shelf', 'shop shelf', 'display', 'mannequin', 'till', 'pos', 'barcode scanner', 'counter', 'showcase', 'receipt printer']::TEXT[]),
  ('salon-equipment', ARRAY['salon chair', 'barber chair', 'hair dryer', 'clipper', 'sterilizer', 'nail station', 'pedicure', 'steamer', 'salon mirror']::TEXT[]),
  ('repair-services', ARRAY['repair', 'mechanic', 'technician', 'plumber', 'electrician', 'ac repair', 'phone repair', 'laptop repair', 'fridge repair', 'generator repair', 'carpenter', 'vulcanizer']::TEXT[]),
  ('construction-services', ARRAY['building contractor', 'contractor', 'bricklayer', 'mason', 'tiler', 'pop ceiling', 'painter', 'roofer', 'welder', 'fabricator', 'architect', 'surveyor', 'renovation', 'interior design', 'screeding']::TEXT[]),
  ('cleaning', ARRAY['cleaning', 'cleaner', 'fumigation', 'pest control', 'laundry', 'dry cleaning', 'house cleaning', 'car wash']::TEXT[]),
  ('events', ARRAY['event', 'dj', 'mc', 'catering', 'decoration', 'canopy', 'chair hire', 'event planner', 'band', 'cake', 'party rental']::TEXT[]),
  ('beauty-services', ARRAY['makeup artist', 'hairdresser', 'barber', 'braider', 'nail technician', 'lash technician', 'spa', 'massage', 'gele tying']::TEXT[]),
  ('tailoring', ARRAY['tailor', 'tailoring', 'fashion designer', 'seamstress', 'sewing', 'alteration', 'bespoke', 'made to measure', 'native wear', 'aso ebi sewing']::TEXT[]),
  ('lessons', ARRAY['lesson', 'tutor', 'home lesson', 'teacher', 'driving school', 'music lesson', 'language', 'jamb', 'waec', 'coding class']::TEXT[]),
  ('it-services', ARRAY['web design', 'website', 'app development', 'graphics design', 'software', 'it support', 'social media', 'seo', 'cctv installation', 'computer repair']::TEXT[]),
  ('photography-video', ARRAY['photographer', 'videographer', 'photography', 'video coverage', 'photo studio', 'drone coverage', 'editing']::TEXT[]),
  ('logistics', ARRAY['delivery', 'dispatch', 'courier', 'movers', 'relocation', 'haulage', 'truck hire', 'shipping', 'clearing']::TEXT[]),
  ('car-services', ARRAY['car hire', 'car rental', 'driver', 'chauffeur', 'airport pickup', 'bus hire', 'taxi']::TEXT[])
) AS v("slug", "words") WHERE c."slug" = v."slug";
