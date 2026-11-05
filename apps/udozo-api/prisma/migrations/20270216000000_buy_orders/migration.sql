-- Udozo: buy orders (docs/UDOZO_RATINGS_PLAN.md, phase 0). The buyer asks to buy a listing at a price, the seller
-- accepts (or counters) before they meet, they trade in person and pay off Udozo, and the seller marks it sold (or the
-- buyer says they bought it). An accepted order holds its units against the listing's stock. A completed order is the
-- record of who bought what, which reviews will read.
CREATE TABLE "classified_buy_orders" (
    "id" UUID NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "listing_id" UUID NOT NULL,
    "conversation_id" UUID,
    "buyer_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "counter_minor" BIGINT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "meet_note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "respond_by" TIMESTAMP(3),
    "meet_by" TIMESTAMP(3),
    "meet_extended" BOOLEAN NOT NULL DEFAULT false,
    "accepted_at" TIMESTAMP(3),
    "bought_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completed_by" TEXT,
    "buyer_confirmed_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "ended_by" TEXT,
    "end_reason" TEXT,
    "closed_at" TIMESTAMP(3),
    "meet_reminded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classified_buy_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classified_buy_orders_status" CHECK ("status" IN ('requested', 'countered', 'accepted', 'completed', 'declined', 'cancelled', 'lapsed', 'expired', 'no_show', 'voided')),
    CONSTRAINT "classified_buy_orders_price" CHECK ("price_minor" > 0 AND ("counter_minor" IS NULL OR "counter_minor" > 0)),
    CONSTRAINT "classified_buy_orders_quantity" CHECK ("quantity" BETWEEN 1 AND 100),
    CONSTRAINT "classified_buy_orders_parties" CHECK ("buyer_id" <> "seller_id")
);
CREATE UNIQUE INDEX "classified_buy_orders_number_key" ON "classified_buy_orders"("number");
-- One open buy order per buyer and listing.
CREATE UNIQUE INDEX "classified_buy_orders_open_key" ON "classified_buy_orders"("buyer_id", "listing_id") WHERE "status" IN ('requested', 'countered', 'accepted');
CREATE INDEX "classified_buy_orders_buyer_id_created_at_idx" ON "classified_buy_orders"("buyer_id", "created_at");
CREATE INDEX "classified_buy_orders_seller_id_created_at_idx" ON "classified_buy_orders"("seller_id", "created_at");
CREATE INDEX "classified_buy_orders_listing_id_status_idx" ON "classified_buy_orders"("listing_id", "status");
CREATE INDEX "classified_buy_orders_status_respond_by_idx" ON "classified_buy_orders"("status", "respond_by");
CREATE INDEX "classified_buy_orders_status_meet_by_idx" ON "classified_buy_orders"("status", "meet_by");
ALTER TABLE "classified_buy_orders" ADD CONSTRAINT "classified_buy_orders_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_buy_orders" ADD CONSTRAINT "classified_buy_orders_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "classified_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "classified_buy_orders" ADD CONSTRAINT "classified_buy_orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_buy_orders" ADD CONSTRAINT "classified_buy_orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A chat card for each step of a buy order.
ALTER TABLE "classified_messages" ADD COLUMN "buy_order_id" UUID;
ALTER TABLE "classified_messages" DROP CONSTRAINT "classified_messages_kind_check";
ALTER TABLE "classified_messages" ADD CONSTRAINT "classified_messages_kind_check" CHECK ("kind" IN ('text', 'photo', 'offer', 'system', 'buy_order'));
ALTER TABLE "classified_messages" ADD CONSTRAINT "classified_messages_buy_order_id_fkey" FOREIGN KEY ("buy_order_id") REFERENCES "classified_buy_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A seller whose buy orders are paused (three buyers said they did not buy in 90 days, or an admin paused them).
ALTER TABLE "classified_sellers" ADD COLUMN "buy_orders_paused_until" TIMESTAMP(3);
ALTER TABLE "classified_sellers" ADD COLUMN "buy_orders_paused_reason" TEXT;

-- Each market's buy order rules.
ALTER TABLE "classified_market_settings" ADD COLUMN "buy_request_hours" INTEGER NOT NULL DEFAULT 48;
ALTER TABLE "classified_market_settings" ADD COLUMN "buy_meet_days" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "classified_market_settings" ADD COLUMN "buy_open_per_buyer" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "classified_market_settings" ADD COLUMN "buy_requests_per_day" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "classified_market_settings" ADD CONSTRAINT "classified_market_settings_buy_rules" CHECK ("buy_request_hours" BETWEEN 1 AND 168 AND "buy_meet_days" BETWEEN 1 AND 30 AND "buy_open_per_buyer" BETWEEN 1 AND 100 AND "buy_requests_per_day" BETWEEN 1 AND 200);
