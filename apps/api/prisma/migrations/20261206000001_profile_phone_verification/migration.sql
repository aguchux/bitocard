-- Profile phone numbers: resellers keep up to five confirmed sign-in numbers, customers one; texts go through the
-- SMS provider an admin picks per market (null: no phone verification there).
ALTER TABLE "countries" ADD COLUMN "sms_provider" TEXT;
ALTER TABLE "customers" ADD COLUMN "phone" TEXT, ADD COLUMN "phone_verified_at" TIMESTAMP(3);
ALTER TABLE "customer_codes" ADD COLUMN "target" TEXT;
CREATE UNIQUE INDEX "customers_store_id_phone_key" ON "customers"("store_id", "phone");

CREATE TABLE "user_phones" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "realm" "Realm" NOT NULL,
    "phone" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_phones_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_phones_realm_phone_key" ON "user_phones"("realm", "phone");
CREATE INDEX "user_phones_user_id_idx" ON "user_phones"("user_id");
ALTER TABLE "user_phones" ADD CONSTRAINT "user_phones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "user_phones" ("id", "user_id", "realm", "phone", "verified_at", "created_at")
SELECT gen_random_uuid(), "id", "realm", "phone", "phone_verified_at", "created_at"
FROM "users" WHERE "realm" = 'reseller' AND "phone" IS NOT NULL AND "phone_verified_at" IS NOT NULL;

-- Markets that had phone verification through Termii keep it.
UPDATE "countries" SET "sms_provider" = 'termii';
