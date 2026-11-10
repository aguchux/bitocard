-- Udozo Connect, phase 5e (docs/UDOZO_CONNECT_PLAN.md, Holding times, demurrage and Loss of care): a day's storage charge
-- on an item kept past its free time (the buyer's after their free hours, paid before they collect it; the seller's
-- after their free days to collect a return), and the seller's Loss of care penalty once those days run out.
ALTER TABLE "connect_settings" ADD COLUMN "demurrage_bps" INTEGER NOT NULL DEFAULT 210,
ADD COLUMN "loc_penalty_bps" INTEGER NOT NULL DEFAULT 210,
ADD COLUMN "loc_penalty_cap_minor" BIGINT NOT NULL DEFAULT 50000;
ALTER TABLE "connect_settings" ADD CONSTRAINT "connect_settings_charges_check" CHECK ("demurrage_bps" BETWEEN 0 AND 10000 AND "loc_penalty_bps" BETWEEN 0 AND 10000 AND "loc_penalty_cap_minor" >= 0);

ALTER TABLE "connect_return_requests" ADD COLUMN "loss_of_care_at" TIMESTAMP(3);

CREATE TABLE "connect_charges" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "payer" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'owed',
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connect_charges_payer_check" CHECK ("payer" IN ('buyer', 'seller')),
    CONSTRAINT "connect_charges_kind_check" CHECK ("kind" IN ('demurrage', 'loc_penalty')),
    CONSTRAINT "connect_charges_status_check" CHECK ("status" IN ('owed', 'paid')),
    CONSTRAINT "connect_charges_amount_check" CHECK ("amount_minor" >= 0)
);

CREATE UNIQUE INDEX "connect_charges_order_id_payer_kind_day_key" ON "connect_charges"("order_id", "payer", "kind", "day");
CREATE INDEX "connect_charges_order_id_status_idx" ON "connect_charges"("order_id", "status");
ALTER TABLE "connect_charges" ADD CONSTRAINT "connect_charges_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "classified_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
