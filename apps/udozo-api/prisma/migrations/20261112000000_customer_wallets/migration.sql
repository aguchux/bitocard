-- Customer wallets: a store customer's own balance, topped up through BitoCard's gateways or a reserved bank account,
-- spent only on that store's products (never withdrawn). On by default (the customer_wallets switch).
ALTER TYPE "AccountKind" ADD VALUE 'customer_wallet';
ALTER TYPE "PaymentPurpose" ADD VALUE 'customer_top_up';

ALTER TABLE "ledger_accounts" ADD COLUMN "customer_id" UUID;
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ledger_accounts_customer_id_idx" ON "ledger_accounts"("customer_id");

-- A customer's top-up or bank transfer: the seller's account it went through stays reseller_id.
ALTER TABLE "payments" ADD COLUMN "customer_id" UUID;
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "payments_customer_id_created_at_idx" ON "payments"("customer_id", "created_at");

-- A customer's own reserved bank account (reseller_id: the store's seller in that market).
ALTER TABLE "reserved_accounts" ADD COLUMN "customer_id" UUID;
ALTER TABLE "reserved_accounts" ADD CONSTRAINT "reserved_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "reserved_accounts_customer_id_idx" ON "reserved_accounts"("customer_id");
