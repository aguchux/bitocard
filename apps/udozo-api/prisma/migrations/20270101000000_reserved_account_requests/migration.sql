-- Flutterwave's own ID for each reserved account (its order_ref), to look the account up there.
ALTER TABLE "reserved_accounts" ADD COLUMN "provider_account_id" TEXT;

-- Every request to open reserved accounts, written before the provider is asked: a lost reply still leaves the
-- owner on record, so transfers into an account the bank opened are credited.
CREATE TABLE "reserved_account_requests" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "reseller_id" UUID NOT NULL,
    "customer_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "claimed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reserved_account_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reserved_account_requests_provider_reference_key" ON "reserved_account_requests"("provider", "reference");
CREATE INDEX "reserved_account_requests_status_updated_at_idx" ON "reserved_account_requests"("status", "updated_at");

-- Accounts opened before this change: their requests, so every existing account has one.
INSERT INTO "reserved_account_requests" ("id", "provider", "reference", "mode", "reseller_id", "customer_id", "currency", "status", "attempts", "created_at", "updated_at")
SELECT DISTINCT ON ("provider", "provider_reference") gen_random_uuid(), "provider", "provider_reference", "mode", "reseller_id", "customer_id", "currency", 'active', 1, "created_at", "created_at"
FROM "reserved_accounts"
ORDER BY "provider", "provider_reference", "created_at";
