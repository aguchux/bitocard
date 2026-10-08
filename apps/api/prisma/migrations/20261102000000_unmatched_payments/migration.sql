-- Money a gateway took that BitoCard cannot credit (paid after the payment closed, or a different amount): kept on the
-- payment, reported to admins and refunded through the same gateway.
ALTER TABLE "payments" ADD COLUMN "unmatched_reason" TEXT,
ADD COLUMN "unmatched_amount_minor" BIGINT,
ADD COLUMN "unmatched_currency" CHAR(3),
ADD COLUMN "unmatched_transaction_id" TEXT,
ADD COLUMN "unmatched_at" TIMESTAMP(3),
ADD COLUMN "unmatched_refund_id" TEXT,
ADD COLUMN "unmatched_refund_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "unmatched_refunded_at" TIMESTAMP(3);

-- The payments job looks for unmatched money still to refund.
CREATE INDEX "payments_unmatched_at_unmatched_refunded_at_idx" ON "payments"("unmatched_at", "unmatched_refunded_at");
