-- Reseller's own integrations, phase 1: which integrations are offered where, and resellers' own connections.
CREATE TYPE "IntegrationApproval" AS ENUM ('automatic', 'review');

CREATE TYPE "ConnectionStatus" AS ENUM ('pending_review', 'active', 'rejected', 'suspended', 'disconnected');

CREATE TABLE "integration_offers" (
    "integration_id" TEXT NOT NULL,
    "global" BOOLEAN NOT NULL DEFAULT false,
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approval" "IntegrationApproval" NOT NULL DEFAULT 'review',
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_offers_pkey" PRIMARY KEY ("integration_id")
);

CREATE TABLE "reseller_connections" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "integration_id" TEXT NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "status" "ConnectionStatus" NOT NULL,
    "credentials_encrypted" TEXT,
    "public_values" JSONB NOT NULL DEFAULT '{}',
    "hints" JSONB NOT NULL DEFAULT '{}',
    "last_checked_at" TIMESTAMP(3),
    "last_check_ok" BOOLEAN,
    "last_check_message" TEXT,
    "decision_note" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "connected_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reseller_connections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reseller_connections_status_idx" ON "reseller_connections"("status");

CREATE UNIQUE INDEX "reseller_connections_reseller_id_integration_id_mode_key" ON "reseller_connections"("reseller_id", "integration_id", "mode");

ALTER TABLE "reseller_connections" ADD CONSTRAINT "reseller_connections_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Own integrations come with Premium to start with; admins change plan features in the admin app.
UPDATE "plans" SET "features" = array_append("features", 'own_integrations') WHERE "code" = 'premium' AND NOT ('own_integrations' = ANY("features"));
