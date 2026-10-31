-- On-chain deposits: networks per asset and chain, customers' derived deposit addresses, the deposits seen on chain,
-- and the order chain providers are asked in.
CREATE TABLE "crypto_networks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "asset" VARCHAR(10) NOT NULL,
    "chain" TEXT NOT NULL,
    "contract" TEXT,
    "test_contract" TEXT,
    "decimals" INTEGER NOT NULL,
    "confirmations" INTEGER NOT NULL,
    "deposits_enabled" BOOLEAN NOT NULL DEFAULT false,
    "double_check_from" TEXT NOT NULL DEFAULT '1000',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crypto_networks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crypto_networks_chain_check" CHECK ("chain" IN ('ETHEREUM', 'BSC', 'TRON', 'SOLANA', 'BITCOIN')),
    CONSTRAINT "crypto_networks_numbers_check" CHECK ("decimals" BETWEEN 0 AND 36 AND "confirmations" BETWEEN 1 AND 1000)
);
CREATE UNIQUE INDEX "crypto_networks_asset_chain_key" ON "crypto_networks"("asset", "chain");

INSERT INTO "crypto_networks" ("asset", "chain", "contract", "test_contract", "decimals", "confirmations") VALUES
    ('USDT', 'TRON', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', NULL, 6, 19),
    ('USDT', 'BSC', '0x55d398326f99059fF775485246999027B3197955', NULL, 18, 15),
    ('USDT', 'ETHEREUM', '0xdAC17F958D2ee523a2206206994597C13D831ec7', NULL, 6, 12),
    ('USDC', 'ETHEREUM', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 6, 12),
    ('USDC', 'BSC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', NULL, 18, 15),
    ('USDC', 'SOLANA', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 6, 32),
    ('BTC', 'BITCOIN', NULL, NULL, 8, 2),
    ('ETH', 'ETHEREUM', NULL, NULL, 18, 12),
    ('BNB', 'BSC', NULL, NULL, 18, 15);

CREATE TABLE "crypto_addresses" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "family" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "key_fingerprint" TEXT NOT NULL,
    "watch_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crypto_addresses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crypto_addresses_family_check" CHECK ("family" IN ('bitcoin', 'evm', 'tron', 'solana') AND "index" >= 0)
);
CREATE UNIQUE INDEX "crypto_addresses_customer_id_mode_family_key" ON "crypto_addresses"("customer_id", "mode", "family");
CREATE UNIQUE INDEX "crypto_addresses_mode_family_index_key" ON "crypto_addresses"("mode", "family", "index");
CREATE UNIQUE INDEX "crypto_addresses_mode_family_address_key" ON "crypto_addresses"("mode", "family", "address");
CREATE INDEX "crypto_addresses_mode_family_watch_until_idx" ON "crypto_addresses"("mode", "family", "watch_until");
ALTER TABLE "crypto_addresses" ADD CONSTRAINT "crypto_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crypto_deposits" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "chain" TEXT NOT NULL,
    "asset" VARCHAR(10) NOT NULL,
    "address" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "output_index" INTEGER NOT NULL,
    "raw_amount" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "block_number" BIGINT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "confirmed_by" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checked_at" TIMESTAMP(3),
    "credited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crypto_deposits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crypto_deposits_status_check" CHECK ("status" IN ('pending', 'credited', 'ignored', 'failed') AND "amount" >= 0)
);
CREATE UNIQUE INDEX "crypto_deposits_chain_tx_hash_output_index_key" ON "crypto_deposits"("chain", "tx_hash", "output_index");
CREATE INDEX "crypto_deposits_status_chain_idx" ON "crypto_deposits"("status", "chain");
CREATE INDEX "crypto_deposits_customer_id_created_at_idx" ON "crypto_deposits"("customer_id", "created_at");
ALTER TABLE "crypto_deposits" ADD CONSTRAINT "crypto_deposits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "chain_routes" (
    "chain" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_block" BIGINT,
    "last_error" TEXT,
    "checked_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chain_routes_pkey" PRIMARY KEY ("chain", "provider")
);

CREATE TABLE "chain_notices" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "body_hash" TEXT NOT NULL,
    "hashes" TEXT[],
    "processed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chain_notices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "chain_notices_body_hash_key" ON "chain_notices"("body_hash");
CREATE INDEX "chain_notices_processed_at_idx" ON "chain_notices"("processed_at");

CREATE TABLE "chain_cursors" (
    "chain" TEXT NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "block" BIGINT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chain_cursors_pkey" PRIMARY KEY ("chain", "mode")
);
