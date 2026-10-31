-- AI for support bots: resellers' own provider keys, and usage of every AI call (BitoCard's keys or theirs).
CREATE TABLE "ai_keys" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "key_encrypted" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checked_at" TIMESTAMP(3) NOT NULL,
    "failed_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_keys_reseller_id_provider_key" ON "ai_keys"("reseller_id", "provider");

CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "store_id" UUID,
    "bot_id" UUID,
    "mode" "LedgerMode" NOT NULL,
    "funding" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "cached_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cost_micros" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_usage_store_id_funding_created_at_idx" ON "ai_usage"("store_id", "funding", "created_at");
CREATE INDEX "ai_usage_reseller_id_created_at_idx" ON "ai_usage"("reseller_id", "created_at");
CREATE INDEX "ai_usage_created_at_idx" ON "ai_usage"("created_at");

-- Support bots on BitoCard's keys come with Premium (admins can change plan features).
UPDATE "plans" SET "features" = array_append("features", 'ai_assistant') WHERE "code" = 'premium' AND NOT ('ai_assistant' = ANY("features"));
