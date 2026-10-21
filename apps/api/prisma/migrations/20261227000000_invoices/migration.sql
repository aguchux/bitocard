-- Invoices, what is owed, and the credit limit.
ALTER TYPE "AccountKind" ADD VALUE 'reseller_owed';

ALTER TABLE "resellers" ADD COLUMN "credit_limit_cents" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "resellers" ADD COLUMN "credit_limit_raised_at" TIMESTAMP(3);
ALTER TABLE "resellers" ADD CONSTRAINT "resellers_credit_limit_check" CHECK ("credit_limit_cents" >= 0 AND "credit_limit_cents" <= 10000);

CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "reseller_id" UUID NOT NULL,
    "store_id" UUID,
    "scope_key" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "paid_minor" BIGINT NOT NULL DEFAULT 0,
    "closed_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "overdue_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoices_amounts_check" CHECK ("paid_minor" >= 0 AND "paid_minor" <= "total_minor")
);
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");
CREATE UNIQUE INDEX "invoices_reseller_id_scope_key_currency_period_start_key" ON "invoices"("reseller_id", "scope_key", "currency", "period_start");
CREATE INDEX "invoices_status_due_at_idx" ON "invoices"("status", "due_at");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "paid_minor" BIGINT NOT NULL,
    "reference" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoice_lines_amounts_check" CHECK ("amount_minor" > 0 AND "paid_minor" >= 0 AND "paid_minor" <= "amount_minor")
);
CREATE UNIQUE INDEX "invoice_lines_reference_key" ON "invoice_lines"("reference");
CREATE INDEX "invoice_lines_invoice_id_created_at_idx" ON "invoice_lines"("invoice_id", "created_at");
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
