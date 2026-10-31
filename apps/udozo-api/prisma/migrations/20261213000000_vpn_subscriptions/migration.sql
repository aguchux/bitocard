CREATE TABLE "vpn_subscriptions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "product_id" UUID NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "supplier_account_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'provisioning',
    "supplier_status" TEXT,
    "starts_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "disabled_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "next_sync_at" TIMESTAMP(3),
    "credential_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vpn_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vpn_subscriptions_order_id_key" ON "vpn_subscriptions"("order_id");
CREATE UNIQUE INDEX "vpn_subscriptions_delivery_id_key" ON "vpn_subscriptions"("delivery_id");
CREATE UNIQUE INDEX "vpn_subscriptions_supplier_code_supplier_account_id_key" ON "vpn_subscriptions"("supplier_code", "supplier_account_id");
CREATE INDEX "vpn_subscriptions_status_next_sync_at_idx" ON "vpn_subscriptions"("status", "next_sync_at");
CREATE INDEX "vpn_subscriptions_reseller_id_mode_created_at_idx" ON "vpn_subscriptions"("reseller_id", "mode", "created_at");

ALTER TABLE "vpn_subscriptions" ADD CONSTRAINT "vpn_subscriptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vpn_subscriptions" ADD CONSTRAINT "vpn_subscriptions_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "order_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
