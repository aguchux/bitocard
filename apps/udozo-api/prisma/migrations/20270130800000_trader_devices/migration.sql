-- Afrippa's traders' devices (docs/CRYPTO_SPINOFF_PLAN.md, step 4: device checks): a keyed hash of the random ID
-- afrippa.com keeps in its own cookie, never the ID itself.
CREATE TABLE "trader_devices" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "device_hash" VARCHAR(64) NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trader_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trader_devices_customer_id_device_hash_key" ON "trader_devices"("customer_id", "device_hash");
CREATE INDEX "trader_devices_device_hash_idx" ON "trader_devices"("device_hash");

ALTER TABLE "trader_devices" ADD CONSTRAINT "trader_devices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
