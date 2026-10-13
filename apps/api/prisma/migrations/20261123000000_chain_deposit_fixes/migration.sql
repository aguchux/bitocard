-- A deposit fails 6 hours after the chain stopped showing it (not after it was first seen); pending deposits are
-- checked in turn per mode, least recently checked first.
ALTER TABLE "crypto_deposits" ADD COLUMN "missing_since" TIMESTAMP(3);
CREATE INDEX "crypto_deposits_status_mode_checked_at_idx" ON "crypto_deposits"("status", "mode", "checked_at");

-- Transactions a scan found but no provider could read yet are kept as notices (provider `scan`) in their mode.
ALTER TABLE "chain_notices" ADD COLUMN "mode" "LedgerMode";

-- Transaction hashes are kept in lower case, so the same transaction can never be recorded (and credited) twice.
UPDATE "crypto_deposits" SET "tx_hash" = lower("tx_hash") WHERE "tx_hash" <> lower("tx_hash")
  AND NOT EXISTS (SELECT 1 FROM "crypto_deposits" AS other WHERE other."chain" = "crypto_deposits"."chain" AND other."tx_hash" = lower("crypto_deposits"."tx_hash") AND other."output_index" = "crypto_deposits"."output_index");
