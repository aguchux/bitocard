-- Udozo POS milestone 9, the rest (docs/UDOZO_POS_PLAN.md): shifts, cash and stock counts made offline (each kept once
-- by the id the till gave it), the device's own signing key (a file of its unsent sales is checked against it), telling
-- the owner when a till has not synced for a day, and the offline limits set per plan.
ALTER TABLE "pos_shifts" ADD COLUMN "client_id" UUID;
CREATE UNIQUE INDEX "pos_shifts_client_key" ON "pos_shifts" ("account_id", "client_id") WHERE "client_id" IS NOT NULL;
ALTER TABLE "pos_shift_cash" ADD COLUMN "client_id" UUID;
CREATE UNIQUE INDEX "pos_shift_cash_client_key" ON "pos_shift_cash" ("client_id") WHERE "client_id" IS NOT NULL;
ALTER TABLE "pos_stock_movements" ADD COLUMN "client_id" UUID;
CREATE UNIQUE INDEX "pos_stock_movements_client_key" ON "pos_stock_movements" ("account_id", "client_id") WHERE "client_id" IS NOT NULL;

ALTER TABLE "pos_devices"
  ADD COLUMN "public_key" JSONB,
  ADD COLUMN "unsynced_notified_at" TIMESTAMP(3);

ALTER TABLE "pos_plans"
  ADD COLUMN "offline_hours" INTEGER NOT NULL DEFAULT 72,
  ADD COLUMN "offline_sales" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "pos_plans" ADD CONSTRAINT "pos_plans_offline_check" CHECK ("offline_hours" BETWEEN 1 AND 168 AND "offline_sales" BETWEEN 1 AND 5000);
