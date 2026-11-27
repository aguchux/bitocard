ALTER TABLE "customers"
  ADD COLUMN "transaction_pin_hash" TEXT,
  ADD COLUMN "transaction_pin_failures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "transaction_pin_locked_until" TIMESTAMP(3),
  ADD COLUMN "transaction_pin_updated_at" TIMESTAMP(3);
