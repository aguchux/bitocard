-- CreateTable
CREATE TABLE "supplier_funding_movements" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_code',
    "requested_by" UUID NOT NULL,
    "cancelled_by" UUID,
    "code_hash" TEXT,
    "code_expires_at" TIMESTAMP(3),
    "code_attempts" INTEGER NOT NULL DEFAULT 0,
    "code_sent_at" TIMESTAMP(3),
    "code_sends" INTEGER NOT NULL DEFAULT 1,
    "entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "supplier_funding_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_funding_movements_number_key" ON "supplier_funding_movements"("number");

-- CreateIndex
CREATE INDEX "supplier_funding_movements_status_created_at_idx" ON "supplier_funding_movements"("status", "created_at");

-- CreateIndex
CREATE INDEX "supplier_funding_movements_supplier_code_idx" ON "supplier_funding_movements"("supplier_code");

-- AddForeignKey
ALTER TABLE "supplier_funding_movements" ADD CONSTRAINT "supplier_funding_movements_supplier_code_fkey" FOREIGN KEY ("supplier_code") REFERENCES "suppliers"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
