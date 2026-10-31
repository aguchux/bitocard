-- Spin and win rewards are kept apart from customers' own crypto (never withdrawn or traded) and can be exchanged into
-- the customer's store wallet. Wins are a crypto promotions expense, no longer paid out of custody.
ALTER TYPE "AccountKind" ADD VALUE 'crypto_spin_rewards';
ALTER TYPE "AccountKind" ADD VALUE 'crypto_promotions';

CREATE TABLE "spin_exchanges" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "amounts" JSONB NOT NULL,
    "usd_cents" INTEGER NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "rate" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spin_exchanges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "spin_exchanges_amounts_check" CHECK ("usd_cents" > 0 AND "amount_minor" > 0)
);

CREATE INDEX "spin_exchanges_customer_id_created_at_idx" ON "spin_exchanges"("customer_id", "created_at");
CREATE INDEX "spin_exchanges_mode_created_at_idx" ON "spin_exchanges"("mode", "created_at");

ALTER TABLE "spin_exchanges" ADD CONSTRAINT "spin_exchanges_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
