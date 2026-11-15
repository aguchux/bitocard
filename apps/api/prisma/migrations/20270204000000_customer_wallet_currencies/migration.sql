-- Store customers' extra wallets: currencies beyond US dollars and their own country's (docs/BITOCARD_MULTI_WALLETS_PLAN.md).
CREATE TABLE "customer_wallet_currencies" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_wallet_currencies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_wallet_currencies_customer_id_currency_key" ON "customer_wallet_currencies"("customer_id", "currency");
ALTER TABLE "customer_wallet_currencies" ADD CONSTRAINT "customer_wallet_currencies_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
