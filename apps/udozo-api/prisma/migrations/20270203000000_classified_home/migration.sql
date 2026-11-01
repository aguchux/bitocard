-- udozo.com's home pages (docs: AGENTS.md, Udozo's home pages): Sponsored placements chosen by Udozo's team, listings'
-- views per day (for trending; the listing's own `views` total is counted from now on too), and the indexes the home
-- page's rails rank with. The pages themselves reuse storefront_pages (keys home:global and home:<CC>).
CREATE TABLE "classified_sponsored_placements" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "country" CHAR(2),
    "position" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "note" TEXT,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classified_sponsored_placements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classified_sponsored_placements_dates_check" CHECK ("ends_at" > "starts_at")
);

CREATE INDEX "classified_sponsored_placements_country_starts_at_idx" ON "classified_sponsored_placements"("country", "starts_at");
CREATE INDEX "classified_sponsored_placements_listing_id_idx" ON "classified_sponsored_placements"("listing_id");
ALTER TABLE "classified_sponsored_placements" ADD CONSTRAINT "classified_sponsored_placements_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "classified_listing_view_days" (
    "listing_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "classified_listing_view_days_pkey" PRIMARY KEY ("listing_id", "day")
);

CREATE INDEX "classified_listing_view_days_day_idx" ON "classified_listing_view_days"("day");
ALTER TABLE "classified_listing_view_days" ADD CONSTRAINT "classified_listing_view_days_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What the rails rank by: the newest live listings of a country, recent price changes, released Safe pay sales, saves.
CREATE INDEX "classified_listings_country_status_published_at_idx" ON "classified_listings"("country", "status", "published_at");
CREATE INDEX "classified_price_history_from_idx" ON "classified_price_history"("from");
CREATE INDEX "classified_orders_country_status_released_at_idx" ON "classified_orders"("country", "status", "released_at");
DROP INDEX "classified_favourites_listing_id_idx";
CREATE INDEX "classified_favourites_listing_id_created_at_idx" ON "classified_favourites"("listing_id", "created_at");
