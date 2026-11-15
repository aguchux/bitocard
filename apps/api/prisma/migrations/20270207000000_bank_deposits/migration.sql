-- Bank deposits: customers top up their wallet by paying cash into, or transferring to, Golojan's own bank accounts
-- (per market, the `bank_deposits` switch), say they paid, and finance credits what arrived.
CREATE TABLE "deposit_bank_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "details" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "deposit_bank_accounts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "deposit_bank_accounts_country_active_idx" ON "deposit_bank_accounts"("country", "active");

CREATE TABLE "bank_deposits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" SERIAL NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "customer_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "account_id" UUID,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "reference" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'awaiting_payment',
    "method" TEXT,
    "sender_name" TEXT,
    "sender_note" TEXT,
    "sent_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "credited_amount_minor" BIGINT,
    "external_reference" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bank_deposits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bank_deposits_amount_check" CHECK ("amount_minor" > 0),
    CONSTRAINT "bank_deposits_status_check" CHECK ("status" IN ('awaiting_payment', 'sent', 'credited', 'rejected', 'cancelled', 'expired'))
);
CREATE UNIQUE INDEX "bank_deposits_number_key" ON "bank_deposits"("number");
CREATE UNIQUE INDEX "bank_deposits_reference_key" ON "bank_deposits"("reference");
CREATE INDEX "bank_deposits_customer_id_created_at_idx" ON "bank_deposits"("customer_id", "created_at");
CREATE INDEX "bank_deposits_status_created_at_idx" ON "bank_deposits"("status", "created_at");
ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "deposit_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
