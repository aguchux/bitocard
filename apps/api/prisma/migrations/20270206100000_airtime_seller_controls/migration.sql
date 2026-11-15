-- New sellers sell less a day until they have completed a few sales; a seller whose "sent" never arrives, or whose
-- transfer the network reverses, gets a strike, and three in 90 days pause their selling until operations clear them.
ALTER TABLE "airtime_networks"
    ADD COLUMN "new_seller_daily_minor" BIGINT NOT NULL DEFAULT 500000,
    ADD COLUMN "established_after" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "airtime_networks" ADD CONSTRAINT "airtime_networks_new_seller_check"
    CHECK ("new_seller_daily_minor" >= "min_amount_minor" AND "new_seller_daily_minor" <= "seller_daily_minor" AND "established_after" BETWEEN 0 AND 100);

ALTER TABLE "airtime_sales" ADD COLUMN "struck_at" TIMESTAMP(3);
CREATE INDEX "airtime_sales_customer_id_struck_at_idx" ON "airtime_sales"("customer_id", "struck_at");

CREATE TABLE "airtime_seller_standings" (
    "customer_id" UUID NOT NULL,
    "cleared_at" TIMESTAMP(3),
    "cleared_by" UUID,
    "clear_reason" TEXT,
    "paused_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "airtime_seller_standings_pkey" PRIMARY KEY ("customer_id")
);
ALTER TABLE "airtime_seller_standings" ADD CONSTRAINT "airtime_seller_standings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
