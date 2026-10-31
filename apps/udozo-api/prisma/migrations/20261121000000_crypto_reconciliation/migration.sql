-- The daily custody check: per asset, what the ledger expects on chain against what BitoCard's signer holds.
CREATE TABLE "crypto_reconciliations" (
    "id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "asset" VARCHAR(10) NOT NULL,
    "expected" BIGINT NOT NULL,
    "held" BIGINT NOT NULL,
    "difference" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crypto_reconciliations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crypto_reconciliations_status_check" CHECK ("status" IN ('matched', 'surplus', 'shortfall', 'unavailable'))
);
CREATE INDEX "crypto_reconciliations_mode_asset_created_at_idx" ON "crypto_reconciliations"("mode", "asset", "created_at");
