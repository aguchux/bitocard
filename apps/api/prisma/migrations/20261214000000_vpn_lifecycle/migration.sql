-- VPN lifecycle: password changes that are retried until the supplier confirms them, supplier check failures and
-- alerts, and the daily reconciliation of the supplier account (credit, billed accounts, credit used).
ALTER TABLE "vpn_subscriptions"
  ADD COLUMN "pending_password_encrypted" TEXT,
  ADD COLUMN "password_changed_at" TIMESTAMP(3),
  ADD COLUMN "sync_failures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_error" TEXT,
  ADD COLUMN "alerted_at" TIMESTAMP(3);

CREATE TABLE "vpn_reconciliations" (
  "id" UUID NOT NULL,
  "supplier_code" TEXT NOT NULL,
  "balance_cents" INTEGER,
  "spent_cents" INTEGER,
  "supplier_active" INTEGER NOT NULL,
  "expected_active" INTEGER NOT NULL,
  "runway_days" DOUBLE PRECISION,
  "unexpected" JSONB NOT NULL DEFAULT '[]',
  "missing" JSONB NOT NULL DEFAULT '[]',
  "complete" BOOLEAN NOT NULL,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vpn_reconciliations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vpn_reconciliations_supplier_code_created_at_idx" ON "vpn_reconciliations"("supplier_code", "created_at");
