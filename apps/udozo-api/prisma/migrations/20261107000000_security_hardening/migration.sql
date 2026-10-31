-- A business rename after verification restarts the 24-hour wait before payouts to its bank accounts.
ALTER TABLE "bank_accounts" ADD COLUMN "payouts_from" TIMESTAMP(3);

-- Card disputes (chargebacks) and BitoCard's expense account for the ones it bears.
ALTER TYPE "AccountKind" ADD VALUE 'chargebacks';

CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_dispute_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "protected" BOOLEAN NOT NULL DEFAULT false,
    "hold_id" UUID,
    "held_minor" BIGINT NOT NULL DEFAULT 0,
    "shortfall_minor" BIGINT NOT NULL DEFAULT 0,
    "reason" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "cleared_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "disputes_status_check" CHECK ("status" IN ('open', 'won', 'lost')),
    CONSTRAINT "disputes_amounts_check" CHECK ("amount_minor" > 0 AND "held_minor" >= 0 AND "shortfall_minor" >= 0 AND "held_minor" + "shortfall_minor" <= "amount_minor")
);

CREATE UNIQUE INDEX "disputes_provider_provider_dispute_id_key" ON "disputes"("provider", "provider_dispute_id");
CREATE INDEX "disputes_reseller_id_mode_status_idx" ON "disputes"("reseller_id", "mode", "status");
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
