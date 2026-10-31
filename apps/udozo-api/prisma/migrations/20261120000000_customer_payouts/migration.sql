-- Bank payouts of store customers' P2P money: their bank accounts (in their verified name, usable after 24 hours) and
-- their payouts, set aside in `customer_payouts_pending` while the bank transfer runs.
ALTER TYPE "AccountKind" ADD VALUE 'customer_payouts_pending';

CREATE TABLE "customer_bank_accounts" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "bank_code" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number_encrypted" TEXT NOT NULL,
    "account_number_last4" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "payouts_from" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    CONSTRAINT "customer_bank_accounts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customer_bank_accounts_customer_id_mode_idx" ON "customer_bank_accounts"("customer_id", "mode");
ALTER TABLE "customer_bank_accounts" ADD CONSTRAINT "customer_bank_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "customer_payouts" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'pending',
    "reference" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_transfer_id" TEXT,
    "failure_reason" TEXT,
    "needs_review_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "customer_payouts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_payouts_amount_check" CHECK ("amount_minor" > 0)
);
CREATE UNIQUE INDEX "customer_payouts_reference_key" ON "customer_payouts"("reference");
CREATE INDEX "customer_payouts_customer_id_created_at_idx" ON "customer_payouts"("customer_id", "created_at");
CREATE INDEX "customer_payouts_status_idx" ON "customer_payouts"("status");
ALTER TABLE "customer_payouts" ADD CONSTRAINT "customer_payouts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_payouts" ADD CONSTRAINT "customer_payouts_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "customer_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
