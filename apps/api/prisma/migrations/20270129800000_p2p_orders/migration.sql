-- Afrippa's escrow engine, step 3 item 3 (docs/CRYPTO_SPINOFF_PLAN.md): orders. Taking an escrow ad opens an order:
-- the seller's coins (the amount and the seller's fee) move to escrow (a customer account of the seller, never below
-- zero); the buyer pays the seller directly within the ad's window and marks it paid; the seller releases the coins
-- (less the buyer's fee) to the buyer, or the order is cancelled by the buyer, expires unpaid, or is appealed and
-- decided by Afrippa's operations. Every step moves from one status to the next once.
ALTER TYPE "AccountKind" ADD VALUE 'crypto_escrow';

CREATE TYPE "P2pOrderStatus" AS ENUM ('pending_payment', 'paid', 'appealed', 'released', 'cancelled', 'returned');

CREATE TABLE "p2p_orders" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "ad_id" UUID NOT NULL,
    "market" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "asset" VARCHAR(10) NOT NULL,
    "maker_id" UUID NOT NULL,
    "taker_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "fiat_minor" BIGINT NOT NULL,
    "seller_fee" BIGINT NOT NULL,
    "buyer_fee" BIGINT NOT NULL,
    "seller_fee_bps" INTEGER NOT NULL,
    "buyer_fee_bps" INTEGER NOT NULL,
    "payment_method_id" UUID NOT NULL,
    "buyer_name" TEXT NOT NULL,
    "payment_window_minutes" INTEGER NOT NULL,
    "pay_by" TIMESTAMP(3) NOT NULL,
    "status" "P2pOrderStatus" NOT NULL DEFAULT 'pending_payment',
    "paid_at" TIMESTAMP(3),
    "appealed_at" TIMESTAMP(3),
    "appealed_by" UUID,
    "appeal_reason" TEXT,
    "closed_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "decided_by" UUID,
    "decision_fault" TEXT,
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "p2p_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "p2p_orders_amounts" CHECK ("amount" > 0 AND "fiat_minor" > 0 AND "seller_fee" >= 0 AND "buyer_fee" >= 0 AND "buyer_fee" < "amount"),
    CONSTRAINT "p2p_orders_parties" CHECK ("seller_id" <> "buyer_id" AND "maker_id" <> "taker_id")
);

CREATE UNIQUE INDEX "p2p_orders_number_key" ON "p2p_orders"("number");
CREATE INDEX "p2p_orders_seller_id_status_idx" ON "p2p_orders"("seller_id", "status");
CREATE INDEX "p2p_orders_buyer_id_status_idx" ON "p2p_orders"("buyer_id", "status");
CREATE INDEX "p2p_orders_status_pay_by_idx" ON "p2p_orders"("status", "pay_by");
CREATE INDEX "p2p_orders_ad_id_idx" ON "p2p_orders"("ad_id");

ALTER TABLE "p2p_orders" ADD CONSTRAINT "p2p_orders_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "p2p_ads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "p2p_orders" ADD CONSTRAINT "p2p_orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "p2p_orders" ADD CONSTRAINT "p2p_orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "p2p_orders" ADD CONSTRAINT "p2p_orders_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "p2p_payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
