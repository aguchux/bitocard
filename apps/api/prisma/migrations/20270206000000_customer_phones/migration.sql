-- A customer keeps up to five confirmed mobile numbers; customers.phone stays the default one.
CREATE TABLE "customer_phones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_phones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_phones_store_id_phone_key" ON "customer_phones"("store_id", "phone");
CREATE INDEX "customer_phones_customer_id_idx" ON "customer_phones"("customer_id");

ALTER TABLE "customer_phones" ADD CONSTRAINT "customer_phones_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every number already confirmed is the customer's first (and default) number.
INSERT INTO "customer_phones" ("customer_id", "store_id", "phone", "verified_at", "created_at")
SELECT "id", "store_id", "phone", "phone_verified_at", "phone_verified_at"
FROM "customers"
WHERE "phone" IS NOT NULL AND "phone_verified_at" IS NOT NULL
ON CONFLICT DO NOTHING;
