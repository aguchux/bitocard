-- B2B reselling stage 4 (docs/BITOCARD_B2B_RESELLING_PLAN.md): resale orders on Safe pay (lock, accept, then debit;
-- a three-way release), their two threads and the buyer's details; stage 4b: shipping with tracking and dispatch
-- photos for every Safe pay order, delivery charges and pickup on listings.

ALTER TYPE "AccountKind" ADD VALUE 'customer_wallet_locked';

-- Listings: pickup, and the delivery charge within the seller's state and elsewhere.
ALTER TABLE "classified_listings"
  ADD COLUMN "pickup" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "delivery_fee_state_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "delivery_fee_nationwide_minor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_fulfilment_check" CHECK ("pickup" OR "delivery" <> 'none');
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_delivery_fees_check" CHECK ("delivery_fee_state_minor" >= 0 AND "delivery_fee_nationwide_minor" >= 0);

-- Suppliers may accept resale orders by themselves.
ALTER TABLE "classified_sellers" ADD COLUMN "resale_auto_accept" BOOLEAN NOT NULL DEFAULT false;

-- Safe pay settings: the longest transit time and the couriers offered.
ALTER TABLE "classified_safe_pay_settings"
  ADD COLUMN "transit_days" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "couriers" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "classified_safe_pay_settings" ADD CONSTRAINT "classified_safe_pay_settings_transit_days_check" CHECK ("transit_days" BETWEEN 1 AND 60);

-- Resellers' resale strikes before this no longer count.
ALTER TABLE "resellers" ADD COLUMN "resale_strikes_cleared_at" TIMESTAMP(3);

-- Orders: resale and shipping.
ALTER TABLE "classified_orders"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "store_id" UUID,
  ADD COLUMN "reseller_id" UUID,
  ADD COLUMN "resale_listing_id" UUID,
  ADD COLUMN "deal_id" UUID,
  ADD COLUMN "supplier_price_minor" BIGINT,
  ADD COLUMN "discount_bps" INTEGER,
  ADD COLUMN "supplier_net_minor" BIGINT,
  ADD COLUMN "reseller_margin_minor" BIGINT,
  ADD COLUMN "reseller_fee_bps" INTEGER,
  ADD COLUMN "reseller_fee_cap_minor" BIGINT,
  ADD COLUMN "reseller_fee_minor" BIGINT,
  ADD COLUMN "reseller_payout_minor" BIGINT,
  ADD COLUMN "delivery_fee_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "delivery_state_id" UUID,
  ADD COLUMN "buyer_phone" TEXT,
  ADD COLUMN "snapshot" JSONB,
  ADD COLUMN "locked_at" TIMESTAMP(3),
  ADD COLUMN "courier" TEXT,
  ADD COLUMN "tracking_number" TEXT,
  ADD COLUMN "tracking_url" TEXT,
  ADD COLUMN "delivered_at" TIMESTAMP(3);
ALTER TABLE "classified_orders" DROP CONSTRAINT "classified_orders_status_check";
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_status_check" CHECK ("status" IN ('requested', 'declined', 'lapsed', 'awaiting_payment', 'cancelled', 'locked', 'paid', 'sent', 'disputed', 'released', 'refunded', 'partly_refunded'));
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_kind_check" CHECK ("kind" IN ('direct', 'resale'));
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_quantity_check" CHECK ("quantity" BETWEEN 1 AND 100);
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_delivery_fee_check" CHECK ("delivery_fee_minor" >= 0);
-- A resale order carries its store, reseller and figures; a direct one none of them.
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_resale_check" CHECK (
  ("kind" = 'resale' AND "store_id" IS NOT NULL AND "reseller_id" IS NOT NULL AND "supplier_price_minor" IS NOT NULL AND "discount_bps" IS NOT NULL
    AND "supplier_net_minor" IS NOT NULL AND "reseller_margin_minor" IS NOT NULL AND "reseller_margin_minor" >= 0
    AND "price_minor" = "supplier_net_minor" + "reseller_margin_minor")
  OR ("kind" = 'direct' AND "store_id" IS NULL AND "reseller_id" IS NULL AND "supplier_net_minor" IS NULL AND "reseller_margin_minor" IS NULL)
);
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "classified_orders_reseller_id_created_at_idx" ON "classified_orders"("reseller_id", "created_at");

-- The shipment timeline.
CREATE TABLE "classified_shipment_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "reported_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "classified_shipment_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classified_shipment_events_status_check" CHECK ("status" IN ('shipped', 'in_transit', 'out_for_delivery', 'delivered', 'failed_attempt', 'returned')),
    CONSTRAINT "classified_shipment_events_reported_by_check" CHECK ("reported_by" IN ('seller', 'courier', 'bitocard'))
);
CREATE INDEX "classified_shipment_events_order_id_created_at_idx" ON "classified_shipment_events"("order_id", "created_at");
ALTER TABLE "classified_shipment_events" ADD CONSTRAINT "classified_shipment_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "classified_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dispatch photos.
CREATE TABLE "classified_dispatch_photos" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "classified_dispatch_photos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "classified_dispatch_photos_order_id_created_at_idx" ON "classified_dispatch_photos"("order_id", "created_at");
ALTER TABLE "classified_dispatch_photos" ADD CONSTRAINT "classified_dispatch_photos_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "classified_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A resale order's order chat and trade thread.
CREATE TABLE "resale_order_messages" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "thread" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "author_id" UUID,
    "body" TEXT NOT NULL DEFAULT '',
    "object_key" TEXT,
    "content_type" TEXT,
    "size" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resale_order_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "resale_order_messages_thread_check" CHECK ("thread" IN ('order', 'trade')),
    CONSTRAINT "resale_order_messages_author_check" CHECK ("author" IN ('buyer', 'supplier', 'reseller', 'bitocard')),
    -- The buyer never writes in (or sees) the trade thread.
    CONSTRAINT "resale_order_messages_trade_check" CHECK ("thread" = 'order' OR "author" <> 'buyer')
);
CREATE INDEX "resale_order_messages_order_id_thread_created_at_idx" ON "resale_order_messages"("order_id", "thread", "created_at");
ALTER TABLE "resale_order_messages" ADD CONSTRAINT "resale_order_messages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "classified_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Views of a resale buyer's details.
CREATE TABLE "resale_buyer_detail_views" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "viewer" TEXT NOT NULL,
    "viewer_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resale_buyer_detail_views_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "resale_buyer_detail_views_viewer_check" CHECK ("viewer" IN ('supplier', 'reseller', 'admin'))
);
CREATE INDEX "resale_buyer_detail_views_order_id_created_at_idx" ON "resale_buyer_detail_views"("order_id", "created_at");
ALTER TABLE "resale_buyer_detail_views" ADD CONSTRAINT "resale_buyer_detail_views_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "classified_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
