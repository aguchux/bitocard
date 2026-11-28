-- Africa's Talking on by default (the owner's request, 28 November 2026): the supplier switched on, its airtime and
-- data markets switched on in every BitoCard market it serves, and the airtime and data it already supplies listed on
-- bitocard.com. Its published discounts and data packages are the integration settings' defaults, so a sync needs only
-- its username and API key; products a later sync creates are listed by it (`listsNewProducts`).
UPDATE "suppliers" SET "enabled" = true, "updated_at" = now() WHERE "code" = 'africas_talking';

INSERT INTO "supplier_markets" ("supplier_code", "country_code", "category", "enabled")
SELECT 'africas_talking', c."code", cat.category::"ProductCategory", true
FROM "countries" c
CROSS JOIN (VALUES ('airtime'), ('data')) AS cat(category)
WHERE c."code" IN ('KE', 'UG', 'TZ', 'NG', 'GH', 'ZA', 'ZM', 'RW', 'MW', 'ET')
  AND EXISTS (SELECT 1 FROM "suppliers" s WHERE s."code" = 'africas_talking')
ON CONFLICT ("supplier_code", "country_code", "category") DO UPDATE SET "enabled" = true;

UPDATE "products" p
SET "listed" = true, "listed_at" = now()
WHERE p."listed" = false
  AND p."category" IN ('airtime', 'data')
  AND EXISTS (SELECT 1 FROM "supplier_products" o WHERE o."product_id" = p."id" AND o."supplier_code" = 'africas_talking' AND o."available" = true);
