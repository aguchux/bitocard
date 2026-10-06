-- Admin feature rules per supplier (Catalog > Suppliers > Features). DIDWW starts with numbers that receive SMS and
-- SMS codes from apps, as synced until now.
ALTER TABLE "suppliers" ADD COLUMN "feature_rules" JSONB NOT NULL DEFAULT '{}';

UPDATE "suppliers" SET "feature_rules" = '{"sms_in": "required", "app_codes": "required"}' WHERE "code" = 'didww';
