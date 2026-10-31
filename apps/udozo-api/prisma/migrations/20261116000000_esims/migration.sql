-- eSIMs kept after their order (status, data use, expiry), and top-ups added to them.
CREATE TABLE "esims" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "product_id" UUID NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "supplier_esim_id" TEXT NOT NULL,
    "iccid" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "supplier_status" TEXT,
    "profile_status" TEXT,
    "data_total_bytes" BIGINT,
    "data_used_bytes" BIGINT,
    "usage_updated_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "top_ups" TEXT NOT NULL DEFAULT 'none',
    "installed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "low_data_notified" INTEGER,
    "expiry_notified" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "esims_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "esims_supplier_code_supplier_esim_id_key" ON "esims"("supplier_code", "supplier_esim_id");
CREATE INDEX "esims_order_id_idx" ON "esims"("order_id");
CREATE INDEX "esims_reseller_id_mode_created_at_idx" ON "esims"("reseller_id", "mode", "created_at");
ALTER TABLE "esims" ADD CONSTRAINT "esims_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "esim_top_ups" (
    "id" UUID NOT NULL,
    "esim_id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "customer_id" UUID,
    "mode" "LedgerMode" NOT NULL,
    "reference" TEXT NOT NULL,
    "supplier_package" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "days" INTEGER,
    "cost_minor" BIGINT NOT NULL,
    "cost_currency" CHAR(3) NOT NULL,
    "wholesale_minor" BIGINT NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "wallet_currency" CHAR(3),
    "wallet_amount_minor" BIGINT,
    "hold_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failure_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_check_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "esim_top_ups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "esim_top_ups_reference_key" ON "esim_top_ups"("reference");
CREATE INDEX "esim_top_ups_esim_id_created_at_idx" ON "esim_top_ups"("esim_id", "created_at");
CREATE INDEX "esim_top_ups_status_next_check_at_idx" ON "esim_top_ups"("status", "next_check_at");
ALTER TABLE "esim_top_ups" ADD CONSTRAINT "esim_top_ups_esim_id_fkey" FOREIGN KEY ("esim_id") REFERENCES "esims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
