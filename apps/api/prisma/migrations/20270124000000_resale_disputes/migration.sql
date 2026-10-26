-- B2B reselling stage 5 (docs/BITOCARD_B2B_RESELLING_PLAN.md): the reseller takes part in a resale order's dispute,
-- BitoCard records whose fault an upheld dispute was (it decides whose strike it is), and buyers and suppliers report
-- a Resale shop, an upheld report being a strike for its reseller.

ALTER TABLE "classified_dispute_messages" DROP CONSTRAINT "classified_dispute_messages_author_check";
ALTER TABLE "classified_dispute_messages" ADD CONSTRAINT "classified_dispute_messages_author_check" CHECK ("author" IN ('buyer', 'seller', 'reseller', 'bitocard'));

-- supplier (the seller's), reseller (the store's note or claims) or none; null before stage 5 (counted as the seller's).
ALTER TABLE "classified_disputes" ADD COLUMN "fault" TEXT;
ALTER TABLE "classified_disputes" ADD CONSTRAINT "classified_disputes_fault_check" CHECK ("fault" IS NULL OR "fault" IN ('supplier', 'reseller', 'none'));

CREATE TABLE "resale_store_reports" (
    "id" UUID NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "store_id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reporter_kind" TEXT NOT NULL,
    "order_id" UUID,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resale_store_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "resale_store_reports_reporter_kind_check" CHECK ("reporter_kind" IN ('buyer', 'supplier')),
    CONSTRAINT "resale_store_reports_reason_check" CHECK ("reason" IN ('claims_ownership', 'misleading', 'pay_outside', 'misused_details', 'other')),
    CONSTRAINT "resale_store_reports_status_check" CHECK ("status" IN ('open', 'upheld', 'dismissed'))
);
CREATE UNIQUE INDEX "resale_store_reports_number_key" ON "resale_store_reports"("number");
CREATE INDEX "resale_store_reports_status_created_at_idx" ON "resale_store_reports"("status", "created_at");
CREATE INDEX "resale_store_reports_reseller_id_status_idx" ON "resale_store_reports"("reseller_id", "status");
-- One open report per reporter and store.
CREATE UNIQUE INDEX "resale_store_reports_open_key" ON "resale_store_reports"("store_id", "reporter_id") WHERE "status" = 'open';
ALTER TABLE "resale_store_reports" ADD CONSTRAINT "resale_store_reports_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resale_store_reports" ADD CONSTRAINT "resale_store_reports_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resale_store_reports" ADD CONSTRAINT "resale_store_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
