-- The twelve markets added closed (20270207000000_african_markets) followed the `classifieds` switch's global setting,
-- which is on, so they showed as marketplaces. Each is switched off by itself, as Nigeria, Ghana and Kenya were before
-- they opened; an admin switches a market on for it on Settings > Feature switches. A market an admin already set is
-- left as they set it.
INSERT INTO "feature_switches" ("id", "key", "country_code", "reseller_id", "enabled", "updated_at")
SELECT gen_random_uuid(), 'classifieds', m."code", NULL, false, CURRENT_TIMESTAMP
FROM (VALUES ('BJ'), ('CM'), ('CG'), ('CD'), ('GA'), ('CI'), ('MZ'), ('RW'), ('SN'), ('SL'), ('UG'), ('ZM')) AS m("code")
WHERE NOT EXISTS (SELECT 1 FROM "feature_switches" f WHERE f."key" = 'classifieds' AND f."country_code" = m."code" AND f."reseller_id" IS NULL);
