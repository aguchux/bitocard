-- Afrippa's escrow engine, step 3 item 6 (docs/CRYPTO_SPINOFF_PLAN.md): feedback after each released order (once
-- per party), blocks between traders, and reports Afrippa's operations decide (an upheld one counts as a strike).
CREATE TABLE "p2p_feedback" (
    "id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "order_id" UUID NOT NULL,
    "from_id" UUID NOT NULL,
    "to_id" UUID NOT NULL,
    "rating" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "p2p_feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "p2p_feedback_rating" CHECK ("rating" IN ('positive', 'negative'))
);
CREATE UNIQUE INDEX "p2p_feedback_order_id_from_id_key" ON "p2p_feedback"("order_id", "from_id");
CREATE INDEX "p2p_feedback_to_id_mode_created_at_idx" ON "p2p_feedback"("to_id", "mode", "created_at");
ALTER TABLE "p2p_feedback" ADD CONSTRAINT "p2p_feedback_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "p2p_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "p2p_blocks" (
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "p2p_blocks_pkey" PRIMARY KEY ("blocker_id", "blocked_id"),
    CONSTRAINT "p2p_blocks_not_self" CHECK ("blocker_id" <> "blocked_id")
);
CREATE INDEX "p2p_blocks_blocked_id_idx" ON "p2p_blocks"("blocked_id");
ALTER TABLE "p2p_blocks" ADD CONSTRAINT "p2p_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "p2p_blocks" ADD CONSTRAINT "p2p_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "p2p_reports" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reported_id" UUID NOT NULL,
    "order_id" UUID,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "p2p_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "p2p_reports_status" CHECK ("status" IN ('open', 'upheld', 'dismissed')),
    CONSTRAINT "p2p_reports_not_self" CHECK ("reporter_id" <> "reported_id")
);
CREATE UNIQUE INDEX "p2p_reports_number_key" ON "p2p_reports"("number");
CREATE UNIQUE INDEX "p2p_reports_one_open" ON "p2p_reports"("reporter_id", "reported_id") WHERE "status" = 'open';
CREATE INDEX "p2p_reports_status_created_at_idx" ON "p2p_reports"("status", "created_at");
CREATE INDEX "p2p_reports_reported_id_status_idx" ON "p2p_reports"("reported_id", "status");
ALTER TABLE "p2p_reports" ADD CONSTRAINT "p2p_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "p2p_reports" ADD CONSTRAINT "p2p_reports_reported_id_fkey" FOREIGN KEY ("reported_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "p2p_reports" ADD CONSTRAINT "p2p_reports_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "p2p_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
