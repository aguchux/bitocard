-- Udozo Connect, phase 7a (docs/UDOZO_CONNECT_PLAN.md, Abandoned and auctioned; Udozo warehouses and Final Return
-- Addresses): Udozo's own warehouses, each centre's Final Return Address, items abandoned a month into Loss of care,
-- and Udozo's pickups of them from centres to the warehouse.
CREATE TABLE "connect_warehouses" (
    "id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "state_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "hours" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "contact_name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connect_warehouses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "connect_warehouses_country_idx" ON "connect_warehouses"("country");
ALTER TABLE "connect_warehouses" ADD CONSTRAINT "connect_warehouses_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "classified_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "connect_centres" ADD COLUMN "fra_warehouse_id" UUID;
ALTER TABLE "connect_centres" ADD CONSTRAINT "connect_centres_fra_warehouse_id_fkey" FOREIGN KEY ("fra_warehouse_id") REFERENCES "connect_warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "connect_settings" ADD COLUMN "abandoned_after_days" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "auction_after_days" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN "claim_days" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "connect_settings" ADD CONSTRAINT "connect_settings_abandon_check" CHECK ("abandoned_after_days" BETWEEN 1 AND 365 AND "auction_after_days" BETWEEN 1 AND 730 AND "claim_days" BETWEEN 1 AND 365);

ALTER TABLE "connect_return_requests" ADD COLUMN "abandoned_at" TIMESTAMP(3);

-- Where an item is once it leaves the centre's shelves for Udozo: awaiting_pickup, in_transit (handed to Udozo's
-- pickup), udozo_warehouse or auctioned; null while it is simply at the centre.
ALTER TABLE "classified_orders" ADD COLUMN "connect_place" TEXT,
ADD COLUMN "connect_warehouse_id" UUID,
ADD COLUMN "connect_with_udozo_at" TIMESTAMP(3),
ADD COLUMN "warehouse_received_at" TIMESTAMP(3);
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_connect_place_check" CHECK ("connect_place" IS NULL OR "connect_place" IN ('awaiting_pickup', 'in_transit', 'udozo_warehouse', 'auctioned'));
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_connect_warehouse_id_fkey" FOREIGN KEY ("connect_warehouse_id") REFERENCES "connect_warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "classified_orders_connect_place_idx" ON "classified_orders"("connect_place") WHERE "connect_place" IS NOT NULL;

CREATE TABLE "connect_pickups" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "centre_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "collector" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "pickup_code" TEXT NOT NULL,
    "code_attempts" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "scheduled_by_id" UUID NOT NULL,
    "collected_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connect_pickups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connect_pickups_status_check" CHECK ("status" IN ('scheduled', 'collected', 'delivered', 'cancelled'))
);
CREATE UNIQUE INDEX "connect_pickups_number_key" ON "connect_pickups"("number");
CREATE INDEX "connect_pickups_centre_id_status_idx" ON "connect_pickups"("centre_id", "status");
ALTER TABLE "connect_pickups" ADD CONSTRAINT "connect_pickups_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "connect_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connect_pickups" ADD CONSTRAINT "connect_pickups_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "connect_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "connect_pickup_items" (
    "id" UUID NOT NULL,
    "pickup_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    -- waiting (to be handed over), handed_over, received (at the warehouse), missing (handed over, never arrived),
    -- removed (the seller collected it first, or it was left out of the hand-over).
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "handed_over_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),

    CONSTRAINT "connect_pickup_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connect_pickup_items_status_check" CHECK ("status" IN ('waiting', 'handed_over', 'received', 'missing', 'removed'))
);
CREATE UNIQUE INDEX "connect_pickup_items_pickup_id_order_id_key" ON "connect_pickup_items"("pickup_id", "order_id");
CREATE INDEX "connect_pickup_items_order_id_idx" ON "connect_pickup_items"("order_id");
ALTER TABLE "connect_pickup_items" ADD CONSTRAINT "connect_pickup_items_pickup_id_fkey" FOREIGN KEY ("pickup_id") REFERENCES "connect_pickups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connect_pickup_items" ADD CONSTRAINT "connect_pickup_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "classified_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
