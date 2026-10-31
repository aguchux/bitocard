-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('processing', 'completed', 'failed', 'refunded');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountKind" ADD VALUE 'supplier_float';
ALTER TYPE "AccountKind" ADD VALUE 'cost_of_sales';

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "quote_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "face_value_minor" BIGINT NOT NULL,
    "face_currency" CHAR(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "wholesale_minor" BIGINT NOT NULL,
    "tax_minor" BIGINT NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "reseller_profit_minor" BIGINT NOT NULL,
    "recipient" JSONB,
    "customer_reference" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'processing',
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "hold_id" UUID,
    "supplier_code" TEXT NOT NULL,
    "supplier_product_id" UUID NOT NULL,
    "supplier_cost_minor" BIGINT NOT NULL,
    "supplier_currency" CHAR(3) NOT NULL,
    "supplier_reference" TEXT NOT NULL,
    "supplier_transaction_id" TEXT,
    "simulate" TEXT,
    "checks" INTEGER NOT NULL DEFAULT 0,
    "next_check_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "receipt_number" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_deliveries" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "code_encrypted" TEXT,
    "pin_encrypted" TEXT,
    "serial" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_attempts" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_quote_id_key" ON "orders"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_supplier_reference_key" ON "orders"("supplier_reference");

-- CreateIndex
CREATE UNIQUE INDEX "orders_receipt_number_key" ON "orders"("receipt_number");

-- CreateIndex
CREATE INDEX "orders_reseller_id_created_at_idx" ON "orders"("reseller_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_status_next_check_at_idx" ON "orders"("status", "next_check_at");

-- CreateIndex
CREATE INDEX "order_deliveries_order_id_idx" ON "order_deliveries"("order_id");

-- CreateIndex
CREATE INDEX "order_attempts_order_id_idx" ON "order_attempts"("order_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_deliveries" ADD CONSTRAINT "order_deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_attempts" ADD CONSTRAINT "order_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Receipt numbers run in sequence across all completed orders.
CREATE SEQUENCE "order_receipt_number_seq" START 1000;

ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check" CHECK ("quantity" > 0 AND "wholesale_minor" > 0 AND "tax_minor" >= 0 AND "supplier_cost_minor" > 0);
