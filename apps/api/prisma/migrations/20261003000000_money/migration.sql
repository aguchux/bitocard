-- CreateEnum
CREATE TYPE "LedgerMode" AS ENUM ('test', 'live');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('reseller_funding', 'reseller_earnings', 'reseller_earnings_held', 'reseller_reserved', 'reseller_payouts_pending', 'provider_balance', 'processing_fees', 'platform_revenue', 'tax_payable', 'adjustments');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('held', 'captured', 'released');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('wallet_top_up', 'reserved_account_deposit');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('pending', 'processing', 'paid', 'failed');

-- AlterTable
ALTER TABLE "resellers" ADD COLUMN     "plan_cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "plan_past_due_since" TIMESTAMP(3),
ADD COLUMN     "plan_renews_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "owner_key" TEXT NOT NULL,
    "reseller_id" UUID,
    "balance_minor" BIGINT NOT NULL DEFAULT 0,
    "non_negative" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "type" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "reseller_id" UUID,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_postings" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,

    CONSTRAINT "ledger_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holds" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "from_funding_minor" BIGINT NOT NULL,
    "from_earnings_minor" BIGINT NOT NULL,
    "status" "HoldStatus" NOT NULL DEFAULT 'held',
    "reference" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earnings_lots" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "reference" TEXT NOT NULL,
    "release_at" TIMESTAMP(3) NOT NULL,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "earnings_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "currency" CHAR(3) NOT NULL,
    "source" TEXT NOT NULL,
    "units_per_usd" DECIMAL(24,10) NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("currency","source")
);

-- CreateTable
CREATE TABLE "currency_settings" (
    "currency" CHAR(3) NOT NULL,
    "margin_bps" INTEGER NOT NULL DEFAULT 150,
    "divergence_bps" INTEGER NOT NULL DEFAULT 300,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "paused_reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currency_settings_pkey" PRIMARY KEY ("currency")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "provider_transaction_id" TEXT,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "fee_minor" BIGINT NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "checkout_url" TEXT,
    "return_url" TEXT,
    "reserved_account_id" UUID,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserved_accounts" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "provider" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "provider_reference" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserved_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "bank_code" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number_encrypted" TEXT NOT NULL,
    "account_number_last4" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'pending',
    "reference" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_transfer_id" TEXT,
    "failure_reason" TEXT,
    "requested_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "country_code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "prices_include_tax" BOOLEAN NOT NULL DEFAULT true,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("country_code")
);

-- CreateIndex
CREATE INDEX "ledger_accounts_reseller_id_idx" ON "ledger_accounts"("reseller_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_kind_mode_currency_owner_key_key" ON "ledger_accounts"("kind", "mode", "currency", "owner_key");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reference_key" ON "journal_entries"("reference");

-- CreateIndex
CREATE INDEX "journal_entries_reseller_id_created_at_idx" ON "journal_entries"("reseller_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_postings_entry_id_idx" ON "ledger_postings"("entry_id");

-- CreateIndex
CREATE INDEX "ledger_postings_account_id_idx" ON "ledger_postings"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "holds_reference_key" ON "holds"("reference");

-- CreateIndex
CREATE INDEX "holds_reseller_id_idx" ON "holds"("reseller_id");

-- CreateIndex
CREATE UNIQUE INDEX "earnings_lots_reference_key" ON "earnings_lots"("reference");

-- CreateIndex
CREATE INDEX "earnings_lots_released_at_release_at_idx" ON "earnings_lots"("released_at", "release_at");

-- CreateIndex
CREATE INDEX "earnings_lots_reseller_id_idx" ON "earnings_lots"("reseller_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");

-- CreateIndex
CREATE INDEX "payments_reseller_id_created_at_idx" ON "payments"("reseller_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_transaction_id_key" ON "payments"("provider", "provider_transaction_id");

-- CreateIndex
CREATE INDEX "reserved_accounts_reseller_id_idx" ON "reserved_accounts"("reseller_id");

-- CreateIndex
CREATE INDEX "reserved_accounts_provider_reference_idx" ON "reserved_accounts"("provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "reserved_accounts_provider_account_number_key" ON "reserved_accounts"("provider", "account_number");

-- CreateIndex
CREATE INDEX "bank_accounts_reseller_id_idx" ON "bank_accounts"("reseller_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_reference_key" ON "payouts"("reference");

-- CreateIndex
CREATE INDEX "payouts_reseller_id_created_at_idx" ON "payouts"("reseller_id", "created_at");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holds" ADD CONSTRAINT "holds_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings_lots" ADD CONSTRAINT "earnings_lots_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reserved_account_id_fkey" FOREIGN KEY ("reserved_account_id") REFERENCES "reserved_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserved_accounts" ADD CONSTRAINT "reserved_accounts_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reseller money can never go below zero, whatever the application does.
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_non_negative_check" CHECK (NOT "non_negative" OR "balance_minor" >= 0);

-- Amounts are positive; direction comes from the postings.
ALTER TABLE "holds" ADD CONSTRAINT "holds_amount_check" CHECK ("amount_minor" > 0 AND "from_funding_minor" >= 0 AND "from_earnings_minor" >= 0 AND "from_funding_minor" + "from_earnings_minor" = "amount_minor");
ALTER TABLE "earnings_lots" ADD CONSTRAINT "earnings_lots_amount_check" CHECK ("amount_minor" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount_minor" > 0 AND "fee_minor" >= 0);
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_amount_check" CHECK ("amount_minor" > 0);
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_amount_check" CHECK ("amount_minor" <> 0);
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_rate_check" CHECK ("rate_bps" >= 0 AND "rate_bps" <= 5000);

-- Pilot currencies: 1.5% disclosed conversion margin; pause conversions if the rate sources differ by more than 3%.
INSERT INTO "currency_settings" ("currency", "margin_bps", "divergence_bps", "updated_at") VALUES
  ('NGN', 150, 300, now()),
  ('GHS', 150, 300, now()),
  ('KES', 150, 300, now());

-- Starting tax rates for the pilot countries, unconfirmed: a finance admin confirms each after tax advice before live sales.
-- Ghana: VAT 15% plus NHIL 2.5% and GETFund levy 2.5%.
INSERT INTO "tax_rates" ("country_code", "name", "rate_bps", "prices_include_tax", "confirmed", "updated_at") VALUES
  ('NG', 'VAT', 750, true, false, now()),
  ('GH', 'VAT', 2000, true, false, now()),
  ('KE', 'VAT', 1600, true, false, now());
