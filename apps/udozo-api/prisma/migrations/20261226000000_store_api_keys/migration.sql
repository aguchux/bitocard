-- API keys, webhook endpoints, events and orders belong to a store.

-- Resellers with keys or endpoints but no store get an unpublished one, so their keys can move to it.
INSERT INTO "stores" ("id", "reseller_id", "name", "subdomain", "updated_at")
SELECT gen_random_uuid(), r."id", r."name", 'store' || substr(replace(r."id"::text, '-', ''), 1, 16), CURRENT_TIMESTAMP
FROM "resellers" r
WHERE r."house" = false
  AND NOT EXISTS (SELECT 1 FROM "stores" s WHERE s."reseller_id" = r."id")
  AND (EXISTS (SELECT 1 FROM "api_keys" k WHERE k."reseller_id" = r."id") OR EXISTS (SELECT 1 FROM "webhook_endpoints" w WHERE w."reseller_id" = r."id"));

ALTER TABLE "api_keys" ADD COLUMN "store_id" UUID;
ALTER TABLE "webhook_endpoints" ADD COLUMN "store_id" UUID;
ALTER TABLE "events" ADD COLUMN "store_id" UUID;
ALTER TABLE "orders" ADD COLUMN "store_id" UUID;

-- Existing keys and endpoints move to the reseller's oldest store.
WITH oldest AS (
  SELECT DISTINCT ON ("reseller_id") "reseller_id", "id" FROM "stores" ORDER BY "reseller_id", "created_at", "id"
)
UPDATE "api_keys" k SET "store_id" = o."id" FROM oldest o WHERE o."reseller_id" = k."reseller_id";
WITH oldest AS (
  SELECT DISTINCT ON ("reseller_id") "reseller_id", "id" FROM "stores" ORDER BY "reseller_id", "created_at", "id"
)
UPDATE "webhook_endpoints" w SET "store_id" = o."id" FROM oldest o WHERE o."reseller_id" = w."reseller_id";
-- Orders: the store their customer bought from, else the oldest store (where the keys that placed them now are).
UPDATE "orders" o SET "store_id" = c."store_id" FROM "customers" c WHERE c."id" = o."customer_id";
WITH oldest AS (
  SELECT DISTINCT ON ("reseller_id") "reseller_id", "id" FROM "stores" ORDER BY "reseller_id", "created_at", "id"
)
UPDATE "orders" o SET "store_id" = s."id" FROM oldest s WHERE o."store_id" IS NULL AND s."reseller_id" = o."reseller_id";

-- Keys of a house account without a store (none expected) cannot be kept.
DELETE FROM "api_keys" WHERE "store_id" IS NULL;
DELETE FROM "webhook_deliveries" WHERE "endpoint_id" IN (SELECT "id" FROM "webhook_endpoints" WHERE "store_id" IS NULL);
UPDATE "events" SET "endpoint_id" = NULL WHERE "endpoint_id" IN (SELECT "id" FROM "webhook_endpoints" WHERE "store_id" IS NULL);
DELETE FROM "webhook_endpoints" WHERE "store_id" IS NULL;

ALTER TABLE "api_keys" ALTER COLUMN "store_id" SET NOT NULL;
ALTER TABLE "webhook_endpoints" ALTER COLUMN "store_id" SET NOT NULL;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "api_keys_store_id_idx" ON "api_keys"("store_id");
CREATE INDEX "webhook_endpoints_store_id_mode_idx" ON "webhook_endpoints"("store_id", "mode");
CREATE INDEX "orders_store_id_idx" ON "orders"("store_id");
