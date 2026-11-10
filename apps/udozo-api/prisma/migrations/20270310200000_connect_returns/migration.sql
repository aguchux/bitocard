-- Udozo Connect, phase 5c (docs/UDOZO_CONNECT_PLAN.md, Return requests): a centre asks to return an item to its seller;
-- the seller accepts it or Udozo approves it, and it is accepted by itself when neither answers in time; the seller then
-- collects it at the centre with their own return code, paying the centre's Connect fee as the return fee.
ALTER TABLE "connect_settings" ADD COLUMN "return_due_days" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN "return_answer_hours" INTEGER NOT NULL DEFAULT 48,
ADD COLUMN "seller_collect_days" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "connect_settings" ADD CONSTRAINT "connect_settings_returns_check" CHECK ("return_due_days" BETWEEN 1 AND 90 AND "return_answer_hours" BETWEEN 1 AND 720 AND "seller_collect_days" BETWEEN 1 AND 90);

CREATE TABLE "connect_return_requests" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "order_id" UUID NOT NULL,
    "centre_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "requested_by_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "answer_by" TIMESTAMP(3) NOT NULL,
    "decided_by" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "return_code" TEXT,
    "code_attempts" INTEGER NOT NULL DEFAULT 0,
    "collect_by" TIMESTAMP(3),
    "return_fee_minor" BIGINT,
    "collected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connect_return_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connect_return_requests_reason_check" CHECK ("reason" IN ('not_collected', 'refused_at_check_in', 'refused_at_counter', 'damaged')),
    CONSTRAINT "connect_return_requests_status_check" CHECK ("status" IN ('requested', 'accepted', 'collected', 'cancelled')),
    CONSTRAINT "connect_return_requests_decided_by_check" CHECK ("decided_by" IS NULL OR "decided_by" IN ('seller', 'admin', 'auto')),
    CONSTRAINT "connect_return_requests_attempts_check" CHECK ("code_attempts" BETWEEN 0 AND 5)
);

CREATE UNIQUE INDEX "connect_return_requests_number_key" ON "connect_return_requests"("number");
CREATE UNIQUE INDEX "connect_return_requests_order_id_key" ON "connect_return_requests"("order_id");
CREATE INDEX "connect_return_requests_status_answer_by_idx" ON "connect_return_requests"("status", "answer_by");
CREATE INDEX "connect_return_requests_centre_id_status_idx" ON "connect_return_requests"("centre_id", "status");

ALTER TABLE "connect_return_requests" ADD CONSTRAINT "connect_return_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "classified_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connect_return_requests" ADD CONSTRAINT "connect_return_requests_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "connect_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
