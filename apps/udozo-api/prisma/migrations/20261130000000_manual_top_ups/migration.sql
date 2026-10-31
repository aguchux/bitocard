-- Finance admins' manual top-ups of reseller and customer wallets, confirmed by a code emailed to the admin.
CREATE TABLE "manual_top_ups" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "reseller_id" UUID,
    "customer_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "external_reference" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_code',
    "requested_by" UUID NOT NULL,
    "cancelled_by" UUID,
    "code_hash" TEXT,
    "code_expires_at" TIMESTAMP(3),
    "code_attempts" INTEGER NOT NULL DEFAULT 0,
    "code_sent_at" TIMESTAMP(3),
    "entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "manual_top_ups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "manual_top_ups_amount_check" CHECK ("amount_minor" > 0),
    CONSTRAINT "manual_top_ups_target_check" CHECK (("reseller_id" IS NULL) <> ("customer_id" IS NULL)),
    CONSTRAINT "manual_top_ups_source_check" CHECK ("source" IN ('received', 'goodwill')),
    CONSTRAINT "manual_top_ups_status_check" CHECK ("status" IN ('awaiting_code', 'completed', 'cancelled'))
);

CREATE UNIQUE INDEX "manual_top_ups_number_key" ON "manual_top_ups"("number");
CREATE INDEX "manual_top_ups_reseller_id_created_at_idx" ON "manual_top_ups"("reseller_id", "created_at");
CREATE INDEX "manual_top_ups_customer_id_created_at_idx" ON "manual_top_ups"("customer_id", "created_at");
CREATE INDEX "manual_top_ups_status_created_at_idx" ON "manual_top_ups"("status", "created_at");

ALTER TABLE "manual_top_ups" ADD CONSTRAINT "manual_top_ups_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_top_ups" ADD CONSTRAINT "manual_top_ups_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
