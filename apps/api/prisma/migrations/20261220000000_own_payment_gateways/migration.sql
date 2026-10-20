-- Resellers' own payment gateways: their own switch and plan feature (separate from own suppliers), and who collects
-- their hosted stores' customer payments.
ALTER TABLE "resellers" ADD COLUMN "payment_collector" TEXT NOT NULL DEFAULT 'own';
ALTER TABLE "resellers" ADD CONSTRAINT "resellers_payment_collector_check" CHECK ("payment_collector" IN ('own', 'bitocard'));

-- Plans and switches that allowed own integrations keep allowing own gateways, so nothing changes for anyone today.
UPDATE "plans" SET "features" = array_append("features", 'own_payment_gateways') WHERE 'own_integrations' = ANY("features") AND NOT ('own_payment_gateways' = ANY("features"));
INSERT INTO "feature_switches" ("id", "key", "country_code", "reseller_id", "enabled", "updated_at")
SELECT gen_random_uuid(), 'own_payment_gateways', "country_code", "reseller_id", "enabled", CURRENT_TIMESTAMP
FROM "feature_switches" s
WHERE s."key" = 'own_integrations'
  AND NOT EXISTS (
    SELECT 1 FROM "feature_switches" t
    WHERE t."key" = 'own_payment_gateways' AND t."country_code" IS NOT DISTINCT FROM s."country_code" AND t."reseller_id" IS NOT DISTINCT FROM s."reseller_id"
  );
