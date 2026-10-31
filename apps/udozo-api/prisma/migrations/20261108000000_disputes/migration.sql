-- Card chargebacks get their own name, so "disputes" is the reseller-first disputes workflow below.
ALTER TABLE "disputes" RENAME TO "chargebacks";
ALTER TABLE "chargebacks" RENAME CONSTRAINT "disputes_pkey" TO "chargebacks_pkey";
ALTER TABLE "chargebacks" RENAME CONSTRAINT "disputes_status_check" TO "chargebacks_status_check";
ALTER TABLE "chargebacks" RENAME CONSTRAINT "disputes_amounts_check" TO "chargebacks_amounts_check";
ALTER TABLE "chargebacks" RENAME CONSTRAINT "disputes_payment_id_fkey" TO "chargebacks_payment_id_fkey";
ALTER INDEX "disputes_provider_provider_dispute_id_key" RENAME TO "chargebacks_provider_provider_dispute_id_key";
ALTER INDEX "disputes_reseller_id_mode_status_idx" RENAME TO "chargebacks_reseller_id_mode_status_idx";

UPDATE "notifications" SET "type" = 'chargeback.opened' WHERE "type" = 'dispute.opened';
UPDATE "notifications" SET "type" = 'chargeback.closed' WHERE "type" = 'dispute.closed';
UPDATE "notifications" SET "type" = 'admin.chargeback.opened' WHERE "type" = 'admin.dispute.opened';
UPDATE "notification_preferences" SET "type" = 'chargeback.opened' WHERE "type" = 'dispute.opened';
UPDATE "notification_preferences" SET "type" = 'chargeback.closed' WHERE "type" = 'dispute.closed';
UPDATE "notification_preferences" SET "type" = 'admin.chargeback.opened' WHERE "type" = 'admin.dispute.opened';

-- Disputes: customers' complaints, resellers' own disputes and chargebacks, investigated by the reseller first and
-- escalated to BitoCard with a report and a recommendation.
CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "kind" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "subject" TEXT NOT NULL,
    "store_id" UUID,
    "customer_id" UUID,
    "customer_reference" TEXT,
    "order_id" UUID,
    "payment_id" UUID,
    "checkout_id" UUID,
    "chargeback_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "recommendation" TEXT,
    "recommended_amount_minor" BIGINT,
    "report" TEXT,
    "escalated_at" TIMESTAMP(3),
    "outcome" TEXT,
    "outcome_amount_minor" BIGINT,
    "outcome_note" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "disputes_kind_check" CHECK ("kind" IN ('customer', 'reseller', 'chargeback')),
    CONSTRAINT "disputes_topic_check" CHECK ("topic" IN ('order', 'payment', 'funding', 'trade', 'other')),
    CONSTRAINT "disputes_status_check" CHECK ("status" IN ('open', 'escalated', 'contested', 'resolved')),
    CONSTRAINT "disputes_amounts_check" CHECK (("recommended_amount_minor" IS NULL OR "recommended_amount_minor" > 0) AND ("outcome_amount_minor" IS NULL OR "outcome_amount_minor" > 0))
);

CREATE UNIQUE INDEX "disputes_number_key" ON "disputes"("number");
CREATE UNIQUE INDEX "disputes_chargeback_id_key" ON "disputes"("chargeback_id");
CREATE INDEX "disputes_reseller_id_mode_status_idx" ON "disputes"("reseller_id", "mode", "status");
CREATE INDEX "disputes_status_escalated_at_idx" ON "disputes"("status", "escalated_at");
CREATE INDEX "disputes_customer_id_created_at_idx" ON "disputes"("customer_id", "created_at");

CREATE TABLE "dispute_messages" (
    "id" UUID NOT NULL,
    "dispute_id" UUID NOT NULL,
    "author" TEXT NOT NULL,
    "author_id" UUID,
    "author_name" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'all',
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dispute_messages_author_check" CHECK ("author" IN ('customer', 'reseller', 'bitocard', 'system')),
    CONSTRAINT "dispute_messages_visibility_check" CHECK ("visibility" IN ('all', 'staff'))
);

CREATE INDEX "dispute_messages_dispute_id_created_at_idx" ON "dispute_messages"("dispute_id", "created_at");
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
