-- Every market gets its own country store, <code>.bitocard.com, switched on, as ng.bitocard.com already is (the owner's
-- request, 26 October 2026). Exactly what HouseService.storeFor() makes: the market's house account (if it has none yet)
-- and a published store named plain "BitoCard" on the classic all-in-one design, live. Its address is left pending, so
-- the `domains` job sets it up in Cloudflare and on the storefront's Vercel project (StoreHostsService); root offers
-- shoppers the country store only once that address is ready. Markets added later get theirs from their first
-- checkout or Settings > Markets, and an admin switches `country_stores` on for them.

-- The market's house account, where it has none yet.
INSERT INTO "resellers" ("id", "name", "country", "status", "plan_code", "house", "verified_at", "updated_at")
SELECT gen_random_uuid(), 'BitoCard', c."code", 'active', 'enterprise', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "countries" c
WHERE NOT EXISTS (SELECT 1 FROM "resellers" r WHERE r."house" AND r."country" = c."code");

-- Its store at the market's own code, unless that name is already taken.
INSERT INTO "stores" ("id", "reseller_id", "name", "subdomain", "status", "published_at", "template", "variant", "theme", "checkout_mode", "updated_at")
SELECT gen_random_uuid(), r."id", 'BitoCard', lower(c."code"), 'published', CURRENT_TIMESTAMP, 'all_in_one', 'classic', 'navy_pink', 'live', CURRENT_TIMESTAMP
FROM "countries" c
JOIN "resellers" r ON r."house" AND r."country" = c."code"
WHERE NOT EXISTS (SELECT 1 FROM "stores" s WHERE s."subdomain" = lower(c."code"));

-- A country store wears BitoCard's own name, never "BitoCard NG" (stores made before that rule).
UPDATE "stores" s SET "name" = 'BitoCard', "updated_at" = CURRENT_TIMESTAMP
FROM "resellers" r
WHERE s."reseller_id" = r."id" AND r."house" AND r."country" IS NOT NULL AND s."subdomain" = lower(r."country") AND s."name" <> 'BitoCard';

-- country_stores on for every market.
UPDATE "feature_switches" SET "enabled" = true, "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'country_stores' AND "reseller_id" IS NULL AND "country_code" IN (SELECT "code" FROM "countries");

INSERT INTO "feature_switches" ("id", "key", "country_code", "reseller_id", "enabled", "updated_at")
SELECT gen_random_uuid(), 'country_stores', c."code", NULL, true, CURRENT_TIMESTAMP
FROM "countries" c
WHERE NOT EXISTS (SELECT 1 FROM "feature_switches" f WHERE f."key" = 'country_stores' AND f."country_code" = c."code" AND f."reseller_id" IS NULL);
