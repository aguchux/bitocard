-- Udozo Connect, phase 7b (docs/UDOZO_CONNECT_PLAN.md, Udozo auctions): abandoned items at Udozo's warehouses, months
-- into Loss of care, auctioned by Udozo on udozo.com to cover the storage owed; what is left over waits for the seller's
-- claim (7c) in `connect_auction_held`.
ALTER TYPE "AccountKind" ADD VALUE 'connect_auction_held';

-- The bidding rules, per market: each bid at least 5% more than the last (and at least ₦500), a bid in the last
-- 5 minutes extends the end to 5 minutes after it, and the winner pays within 48 hours or the next bidder is offered it.
ALTER TABLE "connect_settings" ADD COLUMN "auction_step_bps" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN "auction_step_min_minor" BIGINT NOT NULL DEFAULT 50000,
ADD COLUMN "auction_extend_minutes" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "auction_pay_hours" INTEGER NOT NULL DEFAULT 48;
ALTER TABLE "connect_settings" ADD CONSTRAINT "connect_settings_auction_check" CHECK ("auction_step_bps" BETWEEN 1 AND 5000 AND "auction_step_min_minor" >= 0 AND "auction_extend_minutes" BETWEEN 0 AND 60 AND "auction_pay_hours" BETWEEN 1 AND 336);

CREATE TABLE "connect_auctions" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "order_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warehouse_id" UUID NOT NULL,
    "start_price_minor" BIGINT NOT NULL,
    -- What the seller owed in storage when it was listed, and what Udozo spent selling and moving it (never the pickup).
    "owed_minor" BIGINT NOT NULL,
    "costs_minor" BIGINT NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    -- scheduled, live, awaiting_payment (offered to a bidder), sold, unsold or cancelled.
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "offered_bid_id" UUID,
    "pay_by" TIMESTAMP(3),
    "buyer_id" UUID,
    "sale_minor" BIGINT,
    "paid_at" TIMESTAMP(3),
    -- What the sale left over after what was owed and the costs: the seller's on a claim (7c).
    "left_over_minor" BIGINT,
    "collection_code" TEXT,
    "collected_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connect_auctions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connect_auctions_status_check" CHECK ("status" IN ('scheduled', 'live', 'awaiting_payment', 'sold', 'unsold', 'cancelled')),
    CONSTRAINT "connect_auctions_money_check" CHECK ("start_price_minor" > 0 AND "owed_minor" >= 0 AND "costs_minor" >= 0 AND "ends_at" > "starts_at")
);
CREATE UNIQUE INDEX "connect_auctions_number_key" ON "connect_auctions"("number");
-- One open lot per item; an unsold or cancelled one may be listed again.
CREATE UNIQUE INDEX "connect_auctions_open_order_key" ON "connect_auctions"("order_id") WHERE "status" IN ('scheduled', 'live', 'awaiting_payment', 'sold');
CREATE INDEX "connect_auctions_country_status_ends_at_idx" ON "connect_auctions"("country", "status", "ends_at");
ALTER TABLE "connect_auctions" ADD CONSTRAINT "connect_auctions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "classified_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connect_auctions" ADD CONSTRAINT "connect_auctions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "connect_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connect_auctions" ADD CONSTRAINT "connect_auctions_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "connect_auction_bids" (
    "id" UUID NOT NULL,
    "auction_id" UUID NOT NULL,
    "bidder_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    -- active, offered (asked to pay), lapsed (did not pay in time) or won (paid).
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_auction_bids_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connect_auction_bids_status_check" CHECK ("status" IN ('active', 'offered', 'lapsed', 'won')),
    CONSTRAINT "connect_auction_bids_amount_check" CHECK ("amount_minor" > 0)
);
CREATE INDEX "connect_auction_bids_auction_id_amount_minor_idx" ON "connect_auction_bids"("auction_id", "amount_minor");
CREATE INDEX "connect_auction_bids_bidder_id_idx" ON "connect_auction_bids"("bidder_id");
ALTER TABLE "connect_auction_bids" ADD CONSTRAINT "connect_auction_bids_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "connect_auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connect_auction_bids" ADD CONSTRAINT "connect_auction_bids_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
