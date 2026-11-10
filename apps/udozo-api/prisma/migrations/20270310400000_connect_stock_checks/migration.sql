-- Udozo Connect, phase 5f (docs/UDOZO_CONNECT_PLAN.md, Stock check): a centre's people list what should be in each of
-- its storage places and mark what is there; anything missing is flagged to Udozo at once, and cleared when it is found
-- again or handed over.
CREATE TABLE "connect_stock_checks" (
    "id" UUID NOT NULL,
    "centre_id" UUID NOT NULL,
    "shelf_id" UUID,
    "checked_by_id" UUID NOT NULL,
    "expected" INTEGER NOT NULL,
    "found" INTEGER NOT NULL,
    "missing" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_stock_checks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connect_stock_checks_counts_check" CHECK ("expected" >= 0 AND "found" >= 0 AND "missing" >= 0 AND "found" + "missing" = "expected")
);

CREATE TABLE "connect_stock_check_items" (
    "id" UUID NOT NULL,
    "check_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "shelf_id" UUID,
    "found" BOOLEAN NOT NULL,

    CONSTRAINT "connect_stock_check_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "classified_orders" ADD COLUMN "connect_missing_at" TIMESTAMP(3),
ADD COLUMN "connect_seen_at" TIMESTAMP(3);

CREATE INDEX "connect_stock_checks_centre_id_created_at_idx" ON "connect_stock_checks"("centre_id", "created_at");
CREATE UNIQUE INDEX "connect_stock_check_items_check_id_order_id_key" ON "connect_stock_check_items"("check_id", "order_id");
CREATE INDEX "connect_stock_check_items_order_id_idx" ON "connect_stock_check_items"("order_id");
CREATE INDEX "classified_orders_connect_missing_at_idx" ON "classified_orders"("connect_missing_at") WHERE "connect_missing_at" IS NOT NULL;
ALTER TABLE "connect_stock_checks" ADD CONSTRAINT "connect_stock_checks_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "connect_centres"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connect_stock_checks" ADD CONSTRAINT "connect_stock_checks_shelf_id_fkey" FOREIGN KEY ("shelf_id") REFERENCES "connect_shelves"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "connect_stock_check_items" ADD CONSTRAINT "connect_stock_check_items_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "connect_stock_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connect_stock_check_items" ADD CONSTRAINT "connect_stock_check_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "classified_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
