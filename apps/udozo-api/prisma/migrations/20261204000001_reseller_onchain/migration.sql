-- Premium resellers deposit and withdraw their own coins on chain: deposit addresses, deposits, saved withdrawal
-- addresses and withdrawals belong to a store customer or a reseller, exactly one.
ALTER TABLE "crypto_addresses" ALTER COLUMN "customer_id" DROP NOT NULL, ADD COLUMN "reseller_id" UUID;
ALTER TABLE "crypto_addresses" ADD CONSTRAINT "crypto_addresses_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crypto_addresses" ADD CONSTRAINT "crypto_addresses_one_owner" CHECK (num_nonnulls("customer_id", "reseller_id") = 1);
ALTER TABLE "crypto_deposits" ALTER COLUMN "customer_id" DROP NOT NULL, ADD COLUMN "reseller_id" UUID;
ALTER TABLE "crypto_deposits" ADD CONSTRAINT "crypto_deposits_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crypto_deposits" ADD CONSTRAINT "crypto_deposits_one_owner" CHECK (num_nonnulls("customer_id", "reseller_id") = 1);
ALTER TABLE "crypto_withdrawal_addresses" ALTER COLUMN "customer_id" DROP NOT NULL, ADD COLUMN "reseller_id" UUID;
ALTER TABLE "crypto_withdrawal_addresses" ADD CONSTRAINT "crypto_withdrawal_addresses_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crypto_withdrawal_addresses" ADD CONSTRAINT "crypto_withdrawal_addresses_one_owner" CHECK (num_nonnulls("customer_id", "reseller_id") = 1);
ALTER TABLE "crypto_withdrawals" ALTER COLUMN "customer_id" DROP NOT NULL, ADD COLUMN "reseller_id" UUID, ADD COLUMN "requested_by" UUID;
ALTER TABLE "crypto_withdrawals" ADD CONSTRAINT "crypto_withdrawals_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crypto_withdrawals" ADD CONSTRAINT "crypto_withdrawals_one_owner" CHECK (num_nonnulls("customer_id", "reseller_id") = 1);
CREATE UNIQUE INDEX "crypto_addresses_reseller_id_mode_family_key" ON "crypto_addresses"("reseller_id", "mode", "family");
CREATE INDEX "crypto_deposits_reseller_id_created_at_idx" ON "crypto_deposits"("reseller_id", "created_at");
CREATE UNIQUE INDEX "crypto_withdrawal_addresses_reseller_id_mode_chain_address_key" ON "crypto_withdrawal_addresses"("reseller_id", "mode", "chain", "address");
CREATE INDEX "crypto_withdrawals_reseller_id_created_at_idx" ON "crypto_withdrawals"("reseller_id", "created_at");
-- Only Premium resellers may move coins on chain (a plan feature admins can change).
UPDATE "plans" SET "features" = array_append("features", 'onchain_crypto') WHERE "code" = 'premium' AND NOT ('onchain_crypto' = ANY("features"));
