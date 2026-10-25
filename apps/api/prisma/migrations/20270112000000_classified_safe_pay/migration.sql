-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountKind" ADD VALUE 'classified_escrow';
ALTER TYPE "AccountKind" ADD VALUE 'classifieds_revenue';

-- CreateTable
CREATE TABLE "classified_orders" (
    "id" UUID NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "listing_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "offer_id" UUID,
    "mode" "LedgerMode" NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "buyer_fee_bps" INTEGER NOT NULL,
    "buyer_fee_cap_minor" BIGINT NOT NULL,
    "buyer_fee_minor" BIGINT NOT NULL,
    "seller_fee_bps" INTEGER NOT NULL,
    "seller_fee_cap_minor" BIGINT NOT NULL,
    "seller_fee_minor" BIGINT,
    "fulfilment" TEXT NOT NULL,
    "delivery_address" TEXT,
    "tracking_note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "release_code" TEXT,
    "release_attempts" INTEGER NOT NULL DEFAULT 0,
    "accept_by" TIMESTAMP(3) NOT NULL,
    "pay_by" TIMESTAMP(3),
    "handover_by" TIMESTAMP(3),
    "confirm_by" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "ended_by" TEXT,
    "end_reason" TEXT,
    "refund_minor" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classified_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classified_disputes" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decision" TEXT,
    "refund_minor" BIGINT,
    "note" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classified_dispute_messages" (
    "id" UUID NOT NULL,
    "dispute_id" UUID NOT NULL,
    "author" TEXT NOT NULL,
    "author_id" UUID,
    "body" TEXT NOT NULL DEFAULT '',
    "object_key" TEXT,
    "content_type" TEXT,
    "size" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "classified_orders_number_key" ON "classified_orders"("number");

-- CreateIndex
CREATE INDEX "classified_orders_buyer_id_created_at_idx" ON "classified_orders"("buyer_id", "created_at");

-- CreateIndex
CREATE INDEX "classified_orders_seller_id_created_at_idx" ON "classified_orders"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "classified_orders_listing_id_status_idx" ON "classified_orders"("listing_id", "status");

-- CreateIndex
CREATE INDEX "classified_orders_status_updated_at_idx" ON "classified_orders"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "classified_disputes_order_id_key" ON "classified_disputes"("order_id");

-- CreateIndex
CREATE INDEX "classified_disputes_status_created_at_idx" ON "classified_disputes"("status", "created_at");

-- CreateIndex
CREATE INDEX "classified_dispute_messages_dispute_id_created_at_idx" ON "classified_dispute_messages"("dispute_id", "created_at");

-- AddForeignKey
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_disputes" ADD CONSTRAINT "classified_disputes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "classified_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_dispute_messages" ADD CONSTRAINT "classified_dispute_messages_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "classified_disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Checks the API relies on.
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_sides_check" CHECK ("buyer_id" <> "seller_id");
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_amounts_check" CHECK ("price_minor" > 0 AND "buyer_fee_minor" >= 0 AND ("seller_fee_minor" IS NULL OR "seller_fee_minor" >= 0) AND ("refund_minor" IS NULL OR "refund_minor" >= 0));
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_fulfilment_check" CHECK ("fulfilment" IN ('meet_up', 'delivery'));
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_status_check" CHECK ("status" IN ('requested', 'declined', 'lapsed', 'awaiting_payment', 'cancelled', 'paid', 'sent', 'disputed', 'released', 'refunded', 'partly_refunded'));
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_release_attempts_check" CHECK ("release_attempts" BETWEEN 0 AND 5);
ALTER TABLE "classified_disputes" ADD CONSTRAINT "classified_disputes_reason_check" CHECK ("reason" IN ('not_received', 'not_as_described', 'damaged', 'other'));
ALTER TABLE "classified_disputes" ADD CONSTRAINT "classified_disputes_decision_check" CHECK ("decision" IS NULL OR "decision" IN ('refund', 'partial', 'release'));
ALTER TABLE "classified_dispute_messages" ADD CONSTRAINT "classified_dispute_messages_author_check" CHECK ("author" IN ('buyer', 'seller', 'bitocard'));

-- Order numbers start at 100001 (shown as SP-100001).
ALTER SEQUENCE "classified_orders_number_seq" RESTART WITH 100001;
-- One order holding a listing at a time: once paid, others on it are closed.
CREATE UNIQUE INDEX "classified_orders_holding_key" ON "classified_orders"("listing_id") WHERE "status" IN ('paid', 'sent', 'disputed');
-- One open request per buyer and listing.
CREATE UNIQUE INDEX "classified_orders_open_request_key" ON "classified_orders"("listing_id", "buyer_id") WHERE "status" IN ('requested', 'awaiting_payment');
