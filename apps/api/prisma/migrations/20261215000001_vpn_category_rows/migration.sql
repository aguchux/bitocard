-- VPN exists in every market, switched off until a market is approved, with no customer check by default.
INSERT INTO "country_categories" ("country_code", "category", "enabled", "customer_verification")
SELECT "code", 'vpn'::"ProductCategory", false, false FROM "countries"
ON CONFLICT ("country_code", "category") DO NOTHING;

-- The VPN supplier, its markets and its product move from software to vpn.
UPDATE "suppliers" SET "categories" = ARRAY['vpn']::"ProductCategory"[] WHERE "code" = 'vpnresellers';

INSERT INTO "supplier_markets" ("supplier_code", "country_code", "category", "enabled")
SELECT "supplier_code", "country_code", 'vpn'::"ProductCategory", "enabled" FROM "supplier_markets"
WHERE "supplier_code" = 'vpnresellers' AND "category" = 'software'
ON CONFLICT ("supplier_code", "country_code", "category") DO NOTHING;
DELETE FROM "supplier_markets" WHERE "supplier_code" = 'vpnresellers' AND "category" = 'software';

UPDATE "products" SET "category" = 'vpn', "key" = 'vpn:WW:bitocard:vpn-access-30d'
WHERE "key" = 'software:WW:bitocard:vpn-access-30d'
  AND NOT EXISTS (SELECT 1 FROM "products" WHERE "key" = 'vpn:WW:bitocard:vpn-access-30d');
