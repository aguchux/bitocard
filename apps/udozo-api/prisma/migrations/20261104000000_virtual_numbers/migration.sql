-- Virtual numbers sold through orders: the supplier's ID for each (internal), paid-up date, renewal and reminders.
CREATE TABLE "virtual_numbers" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "product_id" UUID NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "supplier_number_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "monthly_cost_minor" BIGINT NOT NULL,
    "cost_currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "customer_sending" BOOLEAN NOT NULL DEFAULT false,
    "renewed_at" TIMESTAMP(3),
    "reminded_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "warned_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "renewal_error" TEXT,
    "renewal_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtual_numbers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "virtual_numbers_status_check" CHECK ("status" IN ('active', 'expired', 'deleted'))
);

CREATE UNIQUE INDEX "virtual_numbers_order_id_key" ON "virtual_numbers"("order_id");
CREATE UNIQUE INDEX "virtual_numbers_supplier_code_supplier_number_id_key" ON "virtual_numbers"("supplier_code", "supplier_number_id");
CREATE INDEX "virtual_numbers_number_status_idx" ON "virtual_numbers"("number", "status");
CREATE INDEX "virtual_numbers_status_expires_at_idx" ON "virtual_numbers"("status", "expires_at");
CREATE INDEX "virtual_numbers_reseller_id_mode_created_at_idx" ON "virtual_numbers"("reseller_id", "mode", "created_at");

ALTER TABLE "virtual_numbers" ADD CONSTRAINT "virtual_numbers_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Their SMS, text encrypted, kept 90 days.
CREATE TABLE "number_messages" (
    "id" UUID NOT NULL,
    "number_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "text_encrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "supplier_message_id" TEXT,
    "parts" INTEGER NOT NULL DEFAULT 1,
    "cost_minor" BIGINT,
    "charged_minor" BIGINT,
    "hold_id" UUID,
    "failure_reason" TEXT,
    "sent_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "number_messages_direction_check" CHECK ("direction" IN ('in', 'out'))
);

CREATE UNIQUE INDEX "number_messages_direction_supplier_message_id_key" ON "number_messages"("direction", "supplier_message_id");
CREATE INDEX "number_messages_number_id_created_at_idx" ON "number_messages"("number_id", "created_at");
CREATE INDEX "number_messages_created_at_idx" ON "number_messages"("created_at");

ALTER TABLE "number_messages" ADD CONSTRAINT "number_messages_number_id_fkey" FOREIGN KEY ("number_id") REFERENCES "virtual_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
