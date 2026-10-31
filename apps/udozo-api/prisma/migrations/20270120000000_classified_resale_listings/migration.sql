-- B2B reselling, stage 1 (docs/BITOCARD_B2B_RESELLING_PLAN.md): a listing's channels (BitoCard Shop, resellers' stores
-- or both), its resale terms, and stock shared by every channel; BitoCard's resale limits per country.

ALTER TABLE "classified_listings"
  ADD COLUMN "on_shop" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "resale" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "resale_discount_bps" INTEGER,
  ADD COLUMN "resale_markup_max_bps" INTEGER,
  ADD COLUMN "resale_paused_at" TIMESTAMP(3),
  ADD COLUMN "stock" INTEGER NOT NULL DEFAULT 1;

-- Every listing is sold somewhere; stock and the resale terms stay in range whatever the API does.
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_channel_check" CHECK ("on_shop" OR "resale");
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_stock_check" CHECK ("stock" BETWEEN 0 AND 100000);
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_resale_terms_check" CHECK (
  ("resale_discount_bps" IS NULL OR "resale_discount_bps" BETWEEN 0 AND 10000)
  AND ("resale_markup_max_bps" IS NULL OR "resale_markup_max_bps" BETWEEN 0 AND 20000)
  AND (NOT "resale" OR ("resale_discount_bps" IS NOT NULL AND "resale_markup_max_bps" IS NOT NULL))
);

-- A listing with stock can be held by as many paid orders as it has units: the API locks the listing's row and counts
-- them, in place of the one-order-per-listing index.
DROP INDEX "classified_orders_holding_key";

CREATE TABLE "classified_resale_settings" (
  "country" CHAR(2) NOT NULL,
  "discount_min_bps" INTEGER NOT NULL DEFAULT 500,
  "discount_max_bps" INTEGER NOT NULL DEFAULT 5000,
  "markup_max_bps" INTEGER NOT NULL DEFAULT 3000,
  "reseller_fee_bps" INTEGER,
  "reseller_fee_cap_minor" BIGINT,
  "accept_hours" INTEGER NOT NULL DEFAULT 24,
  "reseller_strike_limit" INTEGER NOT NULL DEFAULT 3,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "classified_resale_settings_pkey" PRIMARY KEY ("country"),
  CONSTRAINT "classified_resale_settings_discount_check" CHECK ("discount_min_bps" BETWEEN 0 AND 10000 AND "discount_max_bps" BETWEEN "discount_min_bps" AND 10000),
  CONSTRAINT "classified_resale_settings_markup_check" CHECK ("markup_max_bps" BETWEEN 0 AND 20000),
  CONSTRAINT "classified_resale_settings_fee_check" CHECK (("reseller_fee_bps" IS NULL OR "reseller_fee_bps" BETWEEN 0 AND 5000) AND ("reseller_fee_cap_minor" IS NULL OR "reseller_fee_cap_minor" >= 0)),
  CONSTRAINT "classified_resale_settings_limits_check" CHECK ("accept_hours" BETWEEN 1 AND 168 AND "reseller_strike_limit" BETWEEN 1 AND 20)
);
