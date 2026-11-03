-- Udozo's listing SKUs: every category has a three-letter prefix (PHN for mobile phones), and every ad its SKU, the
-- prefix and the next number of its category (PHN-000123). Admins may change a prefix: SKUs already given keep theirs,
-- and a prefix a category has used stays that category's for good, so no two ads ever share a SKU.

ALTER TABLE "classified_categories" ADD COLUMN "sku_prefix" CHAR(3);
ALTER TABLE "classified_categories" ADD COLUMN "sku_next" INTEGER NOT NULL DEFAULT 1;

UPDATE "classified_categories" AS c SET "sku_prefix" = v."prefix"
FROM (VALUES
  ('phones-tablets', 'PHT'),
  ('electronics', 'ELE'),
  ('vehicles', 'VEH'),
  ('property', 'PRO'),
  ('home-garden', 'HOM'),
  ('fashion', 'FAS'),
  ('health-beauty', 'BEA'),
  ('babies-kids', 'KID'),
  ('sports-leisure', 'SPO'),
  ('animals-pets', 'PET'),
  ('agriculture-food', 'FRM'),
  ('repair-construction', 'BLD'),
  ('business-industrial', 'BIZ'),
  ('services', 'SRV'),
  ('farm-produce', 'PRD'),
  ('food-drinks', 'FOD'),
  ('livestock-poultry', 'LIV'),
  ('feeds-seeds', 'SED'),
  ('farm-machinery', 'FMC'),
  ('dogs', 'DOG'),
  ('cats', 'CAT'),
  ('birds', 'BRD'),
  ('fish', 'FSH'),
  ('pet-accessories', 'PTA'),
  ('baby-gear', 'BGR'),
  ('baby-care', 'BCR'),
  ('kids-clothing', 'KCL'),
  ('kids-furniture', 'KFN'),
  ('toys', 'TOY'),
  ('wholesale', 'WHL'),
  ('industrial-machinery', 'IND'),
  ('office-equipment', 'OFC'),
  ('restaurant-equipment', 'RST'),
  ('retail-equipment', 'RTL'),
  ('salon-equipment', 'SLN'),
  ('laptops', 'LAP'),
  ('desktops', 'DSK'),
  ('computer-accessories', 'CPA'),
  ('printers', 'PRN'),
  ('tvs', 'TVS'),
  ('audio', 'AUD'),
  ('headphones', 'HPH'),
  ('cameras', 'CAM'),
  ('video-games', 'GAM'),
  ('security-surveillance', 'CCT'),
  ('networking', 'NET'),
  ('clothing', 'CLO'),
  ('wedding-wear', 'OCC'),
  ('shoes', 'SHO'),
  ('bags', 'BAG'),
  ('jewellery-watches', 'JWL'),
  ('clothing-accessories', 'ACC'),
  ('skin-care', 'SKN'),
  ('hair-beauty', 'HAR'),
  ('makeup', 'MKP'),
  ('fragrances', 'PRF'),
  ('health-equipment', 'HLT'),
  ('furniture', 'FUR'),
  ('home-appliances', 'APL'),
  ('kitchen-appliances', 'KAP'),
  ('kitchen', 'KIT'),
  ('home-accessories', 'DEC'),
  ('household-supplies', 'HSE'),
  ('generators-solar', 'GEN'),
  ('garden', 'GDN'),
  ('mobile-phones', 'PHN'),
  ('tablets', 'TAB'),
  ('smart-watches', 'SWT'),
  ('phone-accessories', 'PAC'),
  ('houses-for-rent', 'RNT'),
  ('houses-for-sale', 'HSL'),
  ('short-let', 'SHL'),
  ('land', 'LND'),
  ('commercial-property', 'COM'),
  ('event-venues', 'VEN'),
  ('building-materials', 'MAT'),
  ('tools', 'TLS'),
  ('plumbing-electrical', 'PLM'),
  ('doors-windows', 'DOR'),
  ('repair-services', 'REP'),
  ('cleaning', 'CLN'),
  ('events', 'EVT'),
  ('beauty-services', 'BSV'),
  ('lessons', 'LES'),
  ('it-services', 'ITS'),
  ('photography-video', 'PHO'),
  ('logistics', 'LOG'),
  ('car-services', 'CRS'),
  ('fitness', 'FIT'),
  ('sports-equipment', 'SPE'),
  ('bicycles', 'BIK'),
  ('musical-instruments', 'MUS'),
  ('books', 'BOK'),
  ('arts-crafts', 'ART'),
  ('cars', 'CAR'),
  ('motorcycles', 'MOT'),
  ('buses', 'BUS'),
  ('trucks-buses', 'TRK'),
  ('heavy-equipment', 'HVY'),
  ('vehicle-parts', 'VPT')
) AS v("slug", "prefix")
WHERE c."slug" = v."slug";

-- A category this list does not know (one added to this database by hand) gets the first free prefix from its letters.
DO $$
DECLARE
  row RECORD;
  letters TEXT;
  candidate TEXT;
  i INT;
  j INT;
BEGIN
  FOR row IN SELECT "id", "slug" FROM "classified_categories" WHERE "sku_prefix" IS NULL ORDER BY "slug" LOOP
    letters := upper(regexp_replace(row."slug", '[^a-zA-Z]', '', 'g')) || 'XQZ';
    candidate := NULL;
    <<search>>
    FOR i IN 2..length(letters) LOOP
      FOR j IN (i + 1)..length(letters) LOOP
        IF NOT EXISTS (SELECT 1 FROM "classified_categories" WHERE "sku_prefix" = substr(letters, 1, 1) || substr(letters, i, 1) || substr(letters, j, 1)) THEN
          candidate := substr(letters, 1, 1) || substr(letters, i, 1) || substr(letters, j, 1);
          EXIT search;
        END IF;
      END LOOP;
    END LOOP;
    IF candidate IS NULL THEN
      SELECT p INTO candidate FROM (
        SELECT chr(65 + a) || chr(65 + b) || chr(65 + d) AS p FROM generate_series(0, 25) a, generate_series(0, 25) b, generate_series(0, 25) d
      ) AS every WHERE NOT EXISTS (SELECT 1 FROM "classified_categories" WHERE "sku_prefix" = every.p) ORDER BY p LIMIT 1;
    END IF;
    UPDATE "classified_categories" SET "sku_prefix" = candidate WHERE "id" = row."id";
  END LOOP;
END $$;

ALTER TABLE "classified_categories" ALTER COLUMN "sku_prefix" SET NOT NULL;
ALTER TABLE "classified_categories" ADD CONSTRAINT "classified_categories_sku_prefix_check" CHECK ("sku_prefix" ~ '^[A-Z]{3}$');
ALTER TABLE "classified_categories" ADD CONSTRAINT "classified_categories_sku_next_check" CHECK ("sku_next" >= 1);
CREATE UNIQUE INDEX "classified_categories_sku_prefix_key" ON "classified_categories"("sku_prefix");

-- Every prefix a category has had, kept so another category can never take it.
CREATE TABLE "classified_category_sku_prefixes" (
    "prefix" CHAR(3) NOT NULL,
    "category_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_category_sku_prefixes_pkey" PRIMARY KEY ("prefix")
);
CREATE INDEX "classified_category_sku_prefixes_category_id_idx" ON "classified_category_sku_prefixes"("category_id");
ALTER TABLE "classified_category_sku_prefixes" ADD CONSTRAINT "classified_category_sku_prefixes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "classified_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "classified_category_sku_prefixes" ("prefix", "category_id") SELECT "sku_prefix", "id" FROM "classified_categories";

-- Listings: their SKU, numbered in each category by when they were made.
ALTER TABLE "classified_listings" ADD COLUMN "sku" VARCHAR(16);
WITH numbered AS (
  SELECT l."id", l."category_id", row_number() OVER (PARTITION BY l."category_id" ORDER BY l."created_at", l."ref") AS n
  FROM "classified_listings" l
  WHERE l."category_id" IS NOT NULL
)
UPDATE "classified_listings" AS l
SET "sku" = c."sku_prefix" || '-' || CASE WHEN length(x.n::text) >= 6 THEN x.n::text ELSE lpad(x.n::text, 6, '0') END
FROM numbered x JOIN "classified_categories" c ON c."id" = x."category_id"
WHERE l."id" = x."id";
UPDATE "classified_categories" AS c SET "sku_next" = 1 + (SELECT count(*) FROM "classified_listings" l WHERE l."category_id" = c."id");
CREATE UNIQUE INDEX "classified_listings_sku_key" ON "classified_listings"("sku");
