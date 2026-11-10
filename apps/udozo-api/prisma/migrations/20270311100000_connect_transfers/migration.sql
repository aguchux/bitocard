-- Moving an item to a Connect Centre for someone to collect there (docs/UDOZO_CONNECT_PLAN.md): a seller's accepted
-- return sent on to a centre near them, or an abandoned item bought at a Udozo auction sent from Udozo's warehouse.

-- What such a move costs where no listing's own charge applies; null: not offered.
ALTER TABLE "connect_settings" ADD COLUMN "transfer_ship_minor" BIGINT;
ALTER TABLE "connect_settings" ADD CONSTRAINT "connect_settings_transfer_ship_check" CHECK ("transfer_ship_minor" IS NULL OR "transfer_ship_minor" >= 0);

CREATE TABLE "connect_transfers" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "return_id" UUID,
    "auction_id" UUID,
    "from_centre_id" UUID,
    "from_warehouse_id" UUID,
    "to_centre_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "shipping_minor" BIGINT NOT NULL,
    "fee_minor" BIGINT NOT NULL DEFAULT 0,
    "paid_from" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "courier" TEXT,
    "tracking_number" TEXT,
    "sent_at" TIMESTAMP(3),
    "sent_by_id" UUID,
    "arrived_at" TIMESTAMP(3),
    "received_by_id" UUID,
    "shelf_id" UUID,
    "collected_at" TIMESTAMP(3),
    "code_attempts" INTEGER NOT NULL DEFAULT 0,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "cancelled_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "connect_transfers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connect_transfers_kind_check" CHECK ("kind" IN ('return', 'lot')),
    CONSTRAINT "connect_transfers_status_check" CHECK ("status" IN ('paid', 'sent', 'arrived', 'collected', 'cancelled')),
    CONSTRAINT "connect_transfers_paid_from_check" CHECK ("paid_from" IN ('customer_withdrawable', 'customer_wallet')),
    CONSTRAINT "connect_transfers_money_check" CHECK ("shipping_minor" >= 0 AND "fee_minor" >= 0),
    -- A return leaves a centre with its return; a lot leaves Udozo's warehouse with its auction.
    CONSTRAINT "connect_transfers_source_check" CHECK (
        ("kind" = 'return' AND "return_id" IS NOT NULL AND "from_centre_id" IS NOT NULL AND "from_warehouse_id" IS NULL AND "auction_id" IS NULL)
        OR ("kind" = 'lot' AND "auction_id" IS NOT NULL AND "from_warehouse_id" IS NOT NULL AND "from_centre_id" IS NULL AND "return_id" IS NULL)
    )
);
CREATE UNIQUE INDEX "connect_transfers_number_key" ON "connect_transfers"("number");
-- A move cancelled before it was sent leaves room for another: one open move per item (below), not one ever.
CREATE INDEX "connect_transfers_return_id_idx" ON "connect_transfers"("return_id");
CREATE INDEX "connect_transfers_auction_id_idx" ON "connect_transfers"("auction_id");
-- One move at a time per item.
CREATE UNIQUE INDEX "connect_transfers_one_open" ON "connect_transfers"("order_id") WHERE "status" IN ('paid', 'sent', 'arrived');
CREATE INDEX "connect_transfers_to_centre_id_status_idx" ON "connect_transfers"("to_centre_id", "status");
CREATE INDEX "connect_transfers_from_centre_id_status_idx" ON "connect_transfers"("from_centre_id", "status");
CREATE INDEX "connect_transfers_order_id_idx" ON "connect_transfers"("order_id");
ALTER TABLE "connect_transfers" ADD CONSTRAINT "connect_transfers_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "classified_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connect_transfers" ADD CONSTRAINT "connect_transfers_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "connect_return_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connect_transfers" ADD CONSTRAINT "connect_transfers_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "connect_auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connect_transfers" ADD CONSTRAINT "connect_transfers_from_centre_id_fkey" FOREIGN KEY ("from_centre_id") REFERENCES "connect_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connect_transfers" ADD CONSTRAINT "connect_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "connect_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connect_transfers" ADD CONSTRAINT "connect_transfers_to_centre_id_fkey" FOREIGN KEY ("to_centre_id") REFERENCES "connect_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connect_transfers" ADD CONSTRAINT "connect_transfers_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connect_transfers" ADD CONSTRAINT "connect_transfers_shelf_id_fkey" FOREIGN KEY ("shelf_id") REFERENCES "connect_shelves"("id") ON DELETE SET NULL ON UPDATE CASCADE;
