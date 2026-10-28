-- Afrippa's trader standing (docs/CRYPTO_SPINOFF_PLAN.md, step 3 items 5 and 7): strikes come from appeals decided
-- against a trader; reaching the limit pauses their trading until Afrippa's operations clear it. A clearing is kept
-- here: strikes before it no longer count. Cool-offs after a lost appeal and the cancellation limit are worked out
-- from the orders themselves.
CREATE TABLE "p2p_standings" (
    "customer_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "cleared_at" TIMESTAMP(3),
    "cleared_by" UUID,
    "clear_reason" TEXT,
    "notified_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "p2p_standings_pkey" PRIMARY KEY ("customer_id", "mode")
);
ALTER TABLE "p2p_standings" ADD CONSTRAINT "p2p_standings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "p2p_orders_buyer_id_closed_at_idx" ON "p2p_orders"("buyer_id", "closed_at");
CREATE INDEX "p2p_orders_seller_id_closed_at_idx" ON "p2p_orders"("seller_id", "closed_at");
