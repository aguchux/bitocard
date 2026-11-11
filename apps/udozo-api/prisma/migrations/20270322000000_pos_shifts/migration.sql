-- Udozo POS milestone 7 (docs/UDOZO_POS_PLAN.md): shifts and cash-up, the overview and the reports. A till's shift
-- opens with the cash in the drawer, takes the cash of the sales rung up and refunded while it is open, money paid in
-- and out, and closes with the cash counted against what was expected.

CREATE TABLE "pos_shifts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "till_id" UUID,
  "till_name" TEXT NOT NULL,
  "currency" VARCHAR(10) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'open',
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "opened_by_name" VARCHAR(120) NOT NULL,
  "opened_by_staff_id" UUID,
  "opening_float_minor" BIGINT NOT NULL DEFAULT 0,
  "closed_at" TIMESTAMP(3),
  "closed_by_name" VARCHAR(120),
  "closed_by_staff_id" UUID,
  -- At closing: the cash that should be in the drawer, what was counted, and counted less expected (over or short).
  "expected_cash_minor" BIGINT,
  "counted_cash_minor" BIGINT,
  "difference_minor" BIGINT,
  -- At closing: what the shift took, by payment method, with its sales, refunds and items (kept as it was).
  "totals" JSONB,
  "note" VARCHAR(300),
  CONSTRAINT "pos_shifts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_shifts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_shifts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pos_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_shifts_till_id_fkey" FOREIGN KEY ("till_id") REFERENCES "pos_tills"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pos_shifts_status_check" CHECK ("status" IN ('open', 'closed')),
  CONSTRAINT "pos_shifts_float_check" CHECK ("opening_float_minor" >= 0),
  CONSTRAINT "pos_shifts_counted_check" CHECK ("counted_cash_minor" IS NULL OR "counted_cash_minor" >= 0)
);
-- One open shift a till.
CREATE UNIQUE INDEX "pos_shifts_open_till_key" ON "pos_shifts" ("till_id") WHERE "status" = 'open';
CREATE INDEX "pos_shifts_account_opened_idx" ON "pos_shifts" ("account_id", "opened_at" DESC);

-- Cash paid into the drawer (change brought in) or out of it (a supplier paid, cash taken to the bank) during a shift.
CREATE TABLE "pos_shift_cash" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "shift_id" UUID NOT NULL,
  "kind" VARCHAR(8) NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "reason" VARCHAR(200) NOT NULL,
  "by_name" VARCHAR(120) NOT NULL,
  "by_staff_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_shift_cash_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_shift_cash_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "pos_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_shift_cash_kind_check" CHECK ("kind" IN ('in', 'out')),
  CONSTRAINT "pos_shift_cash_amount_check" CHECK ("amount_minor" > 0)
);
CREATE INDEX "pos_shift_cash_shift_idx" ON "pos_shift_cash" ("shift_id", "created_at");

-- The shift a sale was rung up in, and the one its refund was paid out of (the till's open shift then; none without one).
ALTER TABLE "pos_sales"
  ADD COLUMN "shift_id" UUID,
  ADD COLUMN "refund_shift_id" UUID,
  ADD CONSTRAINT "pos_sales_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "pos_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "pos_sales_refund_shift_id_fkey" FOREIGN KEY ("refund_shift_id") REFERENCES "pos_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "pos_sales_shift_idx" ON "pos_sales" ("shift_id");
CREATE INDEX "pos_sales_refund_shift_idx" ON "pos_sales" ("refund_shift_id");
