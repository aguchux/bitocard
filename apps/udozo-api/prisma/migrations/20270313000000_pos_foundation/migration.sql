-- Udozo POS, milestone 1 (docs/UDOZO_POS_PLAN.md): its three plans (Free, Premium, Multi-shop: no prices until finance
-- sets them per market currency), owners' POS accounts (one per Udozo customer), their shops and tills, the plan charges
-- taken from the owner's Udozo wallet into `pos_revenue`, and where pos.udozo.com's app buttons go.
ALTER TYPE "AccountKind" ADD VALUE 'pos_revenue';

-- CreateTable
CREATE TABLE "pos_plans" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "prices" JSONB NOT NULL DEFAULT '{}',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "shown" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_plans_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "pos_accounts" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "country" VARCHAR(2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "plan_code" TEXT NOT NULL,
    "trial_ends_at" TIMESTAMP(3),
    "trial_used_at" TIMESTAMP(3),
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "next_plan_code" TEXT,
    "past_due_since" TIMESTAMP(3),
    "lapsed_plan_code" TEXT,
    "reminded_for" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_shops" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "tin" TEXT,
    "shop_code" TEXT NOT NULL,
    "vat_bps" INTEGER NOT NULL DEFAULT 0,
    "receipt_footer" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_tills" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "printer_width" INTEGER NOT NULL DEFAULT 80,
    "auto_print" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_tills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_charges" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "account_id" UUID NOT NULL,
    "plan_code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "credit_minor" BIGINT NOT NULL DEFAULT 0,
    "amount_minor" BIGINT NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "reference" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_app_links" (
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_app_links_pkey" PRIMARY KEY ("platform")
);

-- CreateIndex
CREATE UNIQUE INDEX "pos_accounts_customer_id_key" ON "pos_accounts"("customer_id");

-- CreateIndex
CREATE INDEX "pos_accounts_plan_code_period_end_idx" ON "pos_accounts"("plan_code", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "pos_shops_shop_code_key" ON "pos_shops"("shop_code");

-- CreateIndex
CREATE INDEX "pos_shops_account_id_position_idx" ON "pos_shops"("account_id", "position");

-- CreateIndex
CREATE INDEX "pos_tills_shop_id_position_idx" ON "pos_tills"("shop_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "pos_charges_number_key" ON "pos_charges"("number");

-- CreateIndex
CREATE UNIQUE INDEX "pos_charges_reference_key" ON "pos_charges"("reference");

-- CreateIndex
CREATE INDEX "pos_charges_account_id_created_at_idx" ON "pos_charges"("account_id", "created_at");

-- AddForeignKey
ALTER TABLE "pos_accounts" ADD CONSTRAINT "pos_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_accounts" ADD CONSTRAINT "pos_accounts_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "pos_plans"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_shops" ADD CONSTRAINT "pos_shops_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_tills" ADD CONSTRAINT "pos_tills_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pos_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_charges" ADD CONSTRAINT "pos_charges_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pos_plans" ADD CONSTRAINT "pos_plans_trial_days_check" CHECK ("trial_days" BETWEEN 0 AND 90);
ALTER TABLE "pos_shops" ADD CONSTRAINT "pos_shops_vat_bps_check" CHECK ("vat_bps" BETWEEN 0 AND 5000);
ALTER TABLE "pos_tills" ADD CONSTRAINT "pos_tills_printer_width_check" CHECK ("printer_width" IN (58, 80));
ALTER TABLE "pos_charges" ADD CONSTRAINT "pos_charges_kind_check" CHECK ("kind" IN ('signup', 'renewal', 'upgrade'));
ALTER TABLE "pos_charges" ADD CONSTRAINT "pos_charges_amounts_check" CHECK ("price_minor" >= 0 AND "credit_minor" >= 0 AND "amount_minor" >= 0);
ALTER TABLE "pos_app_links" ADD CONSTRAINT "pos_app_links_platform_check" CHECK ("platform" IN ('android', 'ios', 'windows'));

-- The three plans, without prices: paid plans are offered in a market once finance sets its currency's price.
INSERT INTO "pos_plans" ("code", "name", "description", "prices", "limits", "trial_days", "shown", "position", "updated_at") VALUES
  ('free', 'Free', 'One shop to start with: up to 50 products at the till.', '{}', '{"products": 50, "shops": 1, "tills": 2, "staff": 3}', 0, true, 0, CURRENT_TIMESTAMP),
  ('premium', 'Premium', 'One shop with no limits: every product, till and member of staff.', '{}', '{"products": null, "shops": 1, "tills": null, "staff": null}', 14, true, 1, CURRENT_TIMESTAMP),
  ('multi_shop', 'Multi-shop', 'Several shops under one account, with no limits.', '{}', '{"products": null, "shops": 10, "tills": null, "staff": null}', 14, true, 2, CURRENT_TIMESTAMP);
