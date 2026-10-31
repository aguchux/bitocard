-- Support bots (one per store, and BitoCard's for resellers) with versioned knowledge documents.
CREATE TABLE "support_bots" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'store',
    "store_id" UUID,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ticket_reply_mode" TEXT NOT NULL DEFAULT 'draft',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "funding" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "greeting" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "instructions" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "suspended_reason" TEXT,
    "knowledge_id" UUID,
    "auto_refresh" BOOLEAN NOT NULL DEFAULT false,
    "knowledge_stale_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "support_bots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "support_bots_store_id_key" ON "support_bots"("store_id");
CREATE INDEX "support_bots_reseller_id_idx" ON "support_bots"("reseller_id");
CREATE INDEX "support_bots_status_idx" ON "support_bots"("status");
-- One platform assistant (BitoCard's, for resellers).
CREATE UNIQUE INDEX "support_bots_one_platform" ON "support_bots"("scope") WHERE "scope" = 'platform';

CREATE TABLE "support_bot_knowledge" (
    "id" UUID NOT NULL,
    "bot_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'md',
    "content" TEXT NOT NULL,
    "chars" INTEGER NOT NULL,
    "data_hash" TEXT,
    "managed_sections" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_bot_knowledge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "support_bot_knowledge_bot_id_version_key" ON "support_bot_knowledge"("bot_id", "version");
ALTER TABLE "support_bot_knowledge" ADD CONSTRAINT "support_bot_knowledge_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "support_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
