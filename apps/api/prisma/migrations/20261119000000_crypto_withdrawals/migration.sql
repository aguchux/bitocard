-- On-chain crypto withdrawals: customers' saved addresses (usable after 24 hours, screened), the withdrawals sent by
-- BitoCard's signer, per-network fees and minimums, per-asset daily limits and the amount from which an admin approves.
ALTER TYPE "AccountKind" ADD VALUE 'crypto_withdrawing';

ALTER TABLE "crypto_assets" ADD COLUMN "withdrawal_daily_limit" TEXT NOT NULL DEFAULT '0';
ALTER TABLE "crypto_assets" ADD COLUMN "withdrawal_review_from" TEXT NOT NULL DEFAULT '0';
UPDATE "crypto_assets" SET "withdrawal_daily_limit" = '10000', "withdrawal_review_from" = '1000' WHERE "code" IN ('USDT', 'USDC');
UPDATE "crypto_assets" SET "withdrawal_daily_limit" = '0.25', "withdrawal_review_from" = '0.02' WHERE "code" = 'BTC';
UPDATE "crypto_assets" SET "withdrawal_daily_limit" = '5', "withdrawal_review_from" = '0.5' WHERE "code" = 'ETH';
UPDATE "crypto_assets" SET "withdrawal_daily_limit" = '20', "withdrawal_review_from" = '2' WHERE "code" = 'BNB';

ALTER TABLE "crypto_networks" ADD COLUMN "withdrawals_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "crypto_networks" ADD COLUMN "withdrawal_fee" TEXT NOT NULL DEFAULT '0';
ALTER TABLE "crypto_networks" ADD COLUMN "min_withdrawal" TEXT NOT NULL DEFAULT '0';
UPDATE "crypto_networks" SET "withdrawal_fee" = '1', "min_withdrawal" = '10' WHERE "asset" = 'USDT' AND "chain" = 'TRON';
UPDATE "crypto_networks" SET "withdrawal_fee" = '0.3', "min_withdrawal" = '10' WHERE "asset" IN ('USDT', 'USDC') AND "chain" = 'BSC';
UPDATE "crypto_networks" SET "withdrawal_fee" = '5', "min_withdrawal" = '20' WHERE "asset" IN ('USDT', 'USDC') AND "chain" = 'ETHEREUM';
UPDATE "crypto_networks" SET "withdrawal_fee" = '1', "min_withdrawal" = '10' WHERE "asset" = 'USDC' AND "chain" = 'SOLANA';
UPDATE "crypto_networks" SET "withdrawal_fee" = '0.0002', "min_withdrawal" = '0.001' WHERE "asset" = 'BTC';
UPDATE "crypto_networks" SET "withdrawal_fee" = '0.002', "min_withdrawal" = '0.01' WHERE "asset" = 'ETH';
UPDATE "crypto_networks" SET "withdrawal_fee" = '0.001', "min_withdrawal" = '0.02' WHERE "asset" = 'BNB';
-- Two providers must agree on large deposits: 1000 suits stablecoins, not coins worth far more each.
UPDATE "crypto_networks" SET "double_check_from" = '0.02' WHERE "asset" = 'BTC' AND "double_check_from" = '1000';
UPDATE "crypto_networks" SET "double_check_from" = '0.5' WHERE "asset" = 'ETH' AND "double_check_from" = '1000';
UPDATE "crypto_networks" SET "double_check_from" = '2' WHERE "asset" = 'BNB' AND "double_check_from" = '1000';

CREATE TABLE "crypto_withdrawal_addresses" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "usable_from" TIMESTAMP(3) NOT NULL,
    "screening" TEXT NOT NULL DEFAULT 'unscreened',
    "screened_by" TEXT,
    "screened_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crypto_withdrawal_addresses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crypto_withdrawal_addresses_check" CHECK ("chain" IN ('ETHEREUM', 'BSC', 'TRON', 'SOLANA', 'BITCOIN') AND "screening" IN ('clear', 'flagged', 'unscreened'))
);
CREATE UNIQUE INDEX "crypto_withdrawal_addresses_customer_id_mode_chain_address_key" ON "crypto_withdrawal_addresses"("customer_id", "mode", "chain", "address");
ALTER TABLE "crypto_withdrawal_addresses" ADD CONSTRAINT "crypto_withdrawal_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crypto_withdrawals" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "customer_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "asset" VARCHAR(10) NOT NULL,
    "chain" TEXT NOT NULL,
    "address_id" UUID,
    "address" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "fee" BIGINT NOT NULL,
    "raw_amount" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_code',
    "code_hash" TEXT,
    "code_expires_at" TIMESTAMP(3),
    "code_attempts" INTEGER NOT NULL DEFAULT 0,
    "code_sent_at" TIMESTAMP(3),
    "review_reason" TEXT,
    "reviewed_by" UUID,
    "review_note" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "signer_reference" TEXT NOT NULL,
    "tx_hash" TEXT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_check_at" TIMESTAMP(3),
    "needs_review_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "crypto_withdrawals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crypto_withdrawals_check" CHECK (
        "amount" > 0 AND "fee" >= 0
        AND "status" IN ('awaiting_code', 'review', 'queued', 'submitting', 'broadcast', 'completed', 'failed', 'rejected', 'cancelled')
    )
);
CREATE UNIQUE INDEX "crypto_withdrawals_number_key" ON "crypto_withdrawals"("number");
CREATE UNIQUE INDEX "crypto_withdrawals_signer_reference_key" ON "crypto_withdrawals"("signer_reference");
CREATE INDEX "crypto_withdrawals_status_next_check_at_idx" ON "crypto_withdrawals"("status", "next_check_at");
CREATE INDEX "crypto_withdrawals_customer_id_created_at_idx" ON "crypto_withdrawals"("customer_id", "created_at");
ALTER TABLE "crypto_withdrawals" ADD CONSTRAINT "crypto_withdrawals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crypto_withdrawals" ADD CONSTRAINT "crypto_withdrawals_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "crypto_withdrawal_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
