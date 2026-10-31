-- RDP exists in every market, switched off until a supplier and the market are approved.
INSERT INTO "country_categories" ("country_code", "category", "enabled", "customer_verification")
SELECT "code", 'rdp'::"ProductCategory", false, false FROM "countries"
ON CONFLICT ("country_code", "category") DO NOTHING;
