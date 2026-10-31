-- Deposit addresses outside their watch window are still read: EVM scans cover every address, and TRON and Bitcoin
-- addresses (read one by one) are swept in turn, oldest first.
ALTER TABLE "crypto_addresses" ADD COLUMN "swept_at" TIMESTAMP(3);
CREATE INDEX "crypto_addresses_mode_family_swept_at_idx" ON "crypto_addresses"("mode", "family", "swept_at");
