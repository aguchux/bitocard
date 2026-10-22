ALTER TABLE "countries"
  ADD COLUMN "public_spins_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "public_spin_limit" INTEGER NOT NULL DEFAULT 6;

CREATE TYPE "PublicSpinClaimStatus" AS ENUM ('active', 'claimed', 'invalidated', 'expired');

CREATE TABLE "public_spin_claims" (
  "id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "store_id" UUID NOT NULL,
  "country_code" CHAR(2) NOT NULL,
  "mode" "LedgerMode" NOT NULL,
  "status" "PublicSpinClaimStatus" NOT NULL DEFAULT 'active',
  "limit" INTEGER NOT NULL DEFAULT 6,
  "schedule" INTEGER[] NOT NULL,
  "wins" JSONB NOT NULL DEFAULT '[]',
  "spins_used" INTEGER NOT NULL DEFAULT 0,
  "won_cents" INTEGER NOT NULL DEFAULT 0,
  "customer_id" UUID,
  "claim_currency" VARCHAR(3),
  "claim_amount_minor" BIGINT,
  "invalidated_reason" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "claimed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "public_spin_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_spin_claims_token_hash_key" ON "public_spin_claims"("token_hash");
CREATE UNIQUE INDEX "public_spin_claims_customer_id_key" ON "public_spin_claims"("customer_id");
CREATE INDEX "public_spin_claims_store_id_status_expires_at_idx" ON "public_spin_claims"("store_id", "status", "expires_at");
ALTER TABLE "public_spin_claims" ADD CONSTRAINT "public_spin_claims_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public_spin_claims" ADD CONSTRAINT "public_spin_claims_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public_spin_claims" ADD CONSTRAINT "public_spin_claims_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
