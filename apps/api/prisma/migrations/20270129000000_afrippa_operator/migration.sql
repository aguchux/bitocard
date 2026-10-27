-- Afrippa's own surface (docs/CRYPTO_SPINOFF_PLAN.md, step 2): the product each account and store belongs to, and
-- Afrippa's operator account with its one store, whose customer accounts are Afrippa's traders (never bitocard.com's).
-- The store is never published on BitoCard: its address is afrippa.com, reached only through Afrippa's signed server.
CREATE TYPE "Platform" AS ENUM ('bitocard', 'afrippa');

ALTER TABLE "resellers" ADD COLUMN "platform" "Platform" NOT NULL DEFAULT 'bitocard';
ALTER TABLE "stores" ADD COLUMN "platform" "Platform" NOT NULL DEFAULT 'bitocard';

INSERT INTO "resellers" ("id", "name", "country", "status", "plan_code", "house", "platform", "verified_at", "created_at", "updated_at")
VALUES ('00000000-0000-4000-8000-0000000000a1', 'Afrippa', NULL, 'active', 'standard', false, 'afrippa', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "stores" ("id", "reseller_id", "name", "subdomain", "status", "checkout_mode", "platform", "host_status", "created_at", "updated_at")
VALUES ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1', 'Afrippa', 'afrippa', 'draft', 'test', 'afrippa', 'none', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
