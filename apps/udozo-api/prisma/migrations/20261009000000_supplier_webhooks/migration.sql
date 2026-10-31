-- CreateEnum
CREATE TYPE "SupplierWebhookStatus" AS ENUM ('received', 'processed', 'unmatched', 'failed');

-- CreateTable
CREATE TABLE "supplier_webhooks" (
    "id" UUID NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "event_type" TEXT,
    "body_hash" TEXT NOT NULL,
    "body_encrypted" TEXT NOT NULL,
    "reference" TEXT,
    "supplier_transaction_id" TEXT,
    "order_id" UUID,
    "status" "SupplierWebhookStatus" NOT NULL DEFAULT 'received',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "supplier_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_webhooks_supplier_code_body_hash_key" ON "supplier_webhooks"("supplier_code", "body_hash");

-- CreateIndex
CREATE INDEX "supplier_webhooks_status_next_attempt_at_idx" ON "supplier_webhooks"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "supplier_webhooks_order_id_idx" ON "supplier_webhooks"("order_id");
