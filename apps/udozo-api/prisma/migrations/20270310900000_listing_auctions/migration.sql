-- Udozo auctions as a way to sell (docs/UDOZO_AUCTIONS_PLAN.md): a listing is sold at a fixed price or by auction. An
-- auction listing has one item, a starting price (its price), an optional hidden reserve and a length in days; its lot
-- is a row of connect_auctions of kind 'listing', its winner paying with UdozoPay through an ordinary order.
ALTER TABLE "classified_listings" ADD COLUMN "sale_method" TEXT NOT NULL DEFAULT 'fixed',
ADD COLUMN "auction_reserve_minor" BIGINT,
ADD COLUMN "auction_days" INTEGER;
-- An auction that did not sell takes its listing off the market until its seller renews it.
ALTER TABLE "classified_listings" DROP CONSTRAINT "classified_listings_expired_reason_check";
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_expired_reason_check" CHECK ("expired_reason" IS NULL OR "expired_reason" IN ('out_of_stock', 'auction_unsold'));
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_sale_method_check" CHECK ("sale_method" IN ('fixed', 'auction') AND ("auction_days" IS NULL OR "auction_days" IN (1, 3, 5, 7, 10)) AND ("auction_reserve_minor" IS NULL OR "auction_reserve_minor" > 0));

-- A lot is an abandoned item's (Udozo Connect) or a listing's.
ALTER TABLE "connect_auctions" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'abandoned',
ADD COLUMN "listing_id" UUID,
ADD COLUMN "seller_id" UUID,
ADD COLUMN "reserve_minor" BIGINT,
ADD COLUMN "sale_order_id" UUID,
ALTER COLUMN "order_id" DROP NOT NULL,
ALTER COLUMN "warehouse_id" DROP NOT NULL,
ALTER COLUMN "created_by_id" DROP NOT NULL;
ALTER TABLE "connect_auctions" ADD CONSTRAINT "connect_auctions_kind_check" CHECK (("kind" = 'abandoned' AND "order_id" IS NOT NULL AND "warehouse_id" IS NOT NULL) OR ("kind" = 'listing' AND "listing_id" IS NOT NULL AND "seller_id" IS NOT NULL));
CREATE UNIQUE INDEX "connect_auctions_sale_order_id_key" ON "connect_auctions"("sale_order_id");
-- One lot running per listing.
CREATE UNIQUE INDEX "connect_auctions_open_listing_key" ON "connect_auctions"("listing_id") WHERE "status" IN ('scheduled', 'live', 'awaiting_payment');
CREATE INDEX "connect_auctions_kind_status_ends_at_idx" ON "connect_auctions"("kind", "status", "ends_at");
ALTER TABLE "connect_auctions" ADD CONSTRAINT "connect_auctions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connect_auctions" ADD CONSTRAINT "connect_auctions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connect_auctions" ADD CONSTRAINT "connect_auctions_sale_order_id_fkey" FOREIGN KEY ("sale_order_id") REFERENCES "classified_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
