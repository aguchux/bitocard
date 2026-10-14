-- Spin and win: each customer's one-time $1 in crypto over 50 to 100 spins, one per person (email) and mode.
CREATE TABLE "spin_allowances" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "email_key" TEXT NOT NULL,
    "schedule" INTEGER[],
    "total_cents" INTEGER NOT NULL DEFAULT 100,
    "spins_used" INTEGER NOT NULL DEFAULT 0,
    "won_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "spin_allowances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "spin_allowances_progress_check" CHECK ("spins_used" >= 0 AND "spins_used" <= cardinality("schedule") AND "won_cents" >= 0 AND "won_cents" <= "total_cents")
);
CREATE UNIQUE INDEX "spin_allowances_mode_email_key_key" ON "spin_allowances"("mode", "email_key");
CREATE INDEX "spin_allowances_customer_id_idx" ON "spin_allowances"("customer_id");
ALTER TABLE "spin_allowances" ADD CONSTRAINT "spin_allowances_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "spins" (
    "id" UUID NOT NULL,
    "allowance_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "number" INTEGER NOT NULL,
    "cents" INTEGER NOT NULL,
    "asset" VARCHAR(10) NOT NULL,
    "amount" BIGINT NOT NULL,
    "segment" INTEGER NOT NULL,
    "price_usd" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "spins_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "spins_amounts_check" CHECK ("cents" BETWEEN 1 AND 10 AND "amount" > 0)
);
CREATE UNIQUE INDEX "spins_allowance_id_number_key" ON "spins"("allowance_id", "number");
CREATE INDEX "spins_customer_id_created_at_idx" ON "spins"("customer_id", "created_at");
CREATE INDEX "spins_mode_created_at_idx" ON "spins"("mode", "created_at");
ALTER TABLE "spins" ADD CONSTRAINT "spins_allowance_id_fkey" FOREIGN KEY ("allowance_id") REFERENCES "spin_allowances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "spins" ADD CONSTRAINT "spins_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
