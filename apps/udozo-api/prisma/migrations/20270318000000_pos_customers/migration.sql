-- Udozo POS customers (docs/UDOZO_POS_PLAN.md; 11 November 2026, the owner's decision): every customer at the till is
-- the shop's own record, needing no Udozo account. A Udozo customer who pays through Udozo (the wallet at the till, or
-- asked by their mobile number) is added to the shop's customers on the way, linked to their account, which stays as it
-- is. A record keeps the details, the sales it is linked to, the contact receipts go to, what the customer owes for
-- goods sold on credit ("pay later") with every sale and repayment, and, for a linked one, their Udozo rating.
-- Udozo's admins read them under the POS account.

CREATE TABLE "pos_customers" (
  "id" UUID NOT NULL,
  "number" SERIAL NOT NULL,
  "account_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  -- E.164, unique within the shop's account.
  "phone" VARCHAR(20),
  "email" VARCHAR(254),
  "address" VARCHAR(300),
  "notes" VARCHAR(1000),
  -- The Udozo account they paid through Udozo with: never needed, never changed by the shop.
  "udozo_customer_id" UUID,
  -- The most the shop lets them owe (minor units); null: no limit set.
  "credit_limit_minor" BIGINT,
  "owed_minor" BIGINT NOT NULL DEFAULT 0,
  "sales_count" INTEGER NOT NULL DEFAULT 0,
  "spent_minor" BIGINT NOT NULL DEFAULT 0,
  "last_sale_at" TIMESTAMPTZ,
  -- Added at the till or the dashboard (`shop`), or by paying through Udozo (`udozo`).
  "source" VARCHAR(16) NOT NULL DEFAULT 'shop',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_customers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_customers_owed_check" CHECK ("owed_minor" >= 0 AND ("credit_limit_minor" IS NULL OR "credit_limit_minor" >= 0) AND "spent_minor" >= 0 AND "sales_count" >= 0),
  CONSTRAINT "pos_customers_source_check" CHECK ("source" IN ('shop', 'udozo')),
  CONSTRAINT "pos_customers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_customers_udozo_fkey" FOREIGN KEY ("udozo_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "pos_customers_number_key" ON "pos_customers" ("number");
CREATE UNIQUE INDEX "pos_customers_phone_key" ON "pos_customers" ("account_id", "phone") WHERE "phone" IS NOT NULL;
CREATE UNIQUE INDEX "pos_customers_udozo_key" ON "pos_customers" ("account_id", "udozo_customer_id") WHERE "udozo_customer_id" IS NOT NULL;
CREATE INDEX "pos_customers_account_idx" ON "pos_customers" ("account_id", "updated_at" DESC);

-- What a customer owes, line by line: a sale's pay-later part, a repayment, or a refund of a sale bought on credit.
CREATE TABLE "pos_customer_entries" (
  "id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  -- Positive adds to what is owed (a credit sale), negative takes it off.
  "amount_minor" BIGINT NOT NULL,
  "owed_after_minor" BIGINT NOT NULL,
  "sale_id" UUID,
  -- How a repayment was paid: cash, transfer, card or other (recorded only).
  "method" VARCHAR(16),
  "reference" VARCHAR(80),
  "note" VARCHAR(300),
  "by_name" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_customer_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_customer_entries_kind_check" CHECK ("kind" IN ('credit_sale', 'repayment', 'refund')),
  CONSTRAINT "pos_customer_entries_method_check" CHECK ("method" IS NULL OR "method" IN ('cash', 'transfer', 'card', 'other')),
  CONSTRAINT "pos_customer_entries_owed_check" CHECK ("owed_after_minor" >= 0),
  CONSTRAINT "pos_customer_entries_customer_fkey" FOREIGN KEY ("customer_id") REFERENCES "pos_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_customer_entries_sale_fkey" FOREIGN KEY ("sale_id") REFERENCES "pos_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "pos_customer_entries_customer_idx" ON "pos_customer_entries" ("customer_id", "created_at" DESC);

ALTER TABLE "pos_sales" ADD COLUMN "customer_id" UUID;
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_customer_fkey" FOREIGN KEY ("customer_id") REFERENCES "pos_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "pos_sales_customer_idx" ON "pos_sales" ("customer_id", "created_at" DESC);

-- A wallet request may name the customer the cashier chose.
ALTER TABLE "pos_wallet_requests" ADD COLUMN "customer_id" UUID;
ALTER TABLE "pos_wallet_requests" ADD CONSTRAINT "pos_wallet_requests_customer_fkey" FOREIGN KEY ("customer_id") REFERENCES "pos_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pay later: a sale's part the customer owes the shop.
ALTER TABLE "pos_payments" DROP CONSTRAINT "pos_payments_method_check";
ALTER TABLE "pos_payments" ADD CONSTRAINT "pos_payments_method_check" CHECK ("method" IN ('cash', 'transfer', 'card', 'other', 'udozo_wallet', 'credit'));
