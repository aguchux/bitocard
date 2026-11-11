-- Udozo POS milestone 2 (docs/UDOZO_POS_PLAN.md): a listing sold at the owner's shop through Udozo POS.

-- When the seller ticked Sell at POS (null: not sold at the till). The order decides which listings Free's product
-- limit keeps selling when a paid plan lapses (the first ticked first).
ALTER TABLE "classified_listings" ADD COLUMN "pos_enabled_at" TIMESTAMPTZ;
-- What the till scans: unique among the seller's listings that are not deleted.
ALTER TABLE "classified_listings" ADD COLUMN "barcode" VARCHAR(48);
-- Low stock at the POS once stock is this or fewer (null: never).
ALTER TABLE "classified_listings" ADD COLUMN "reorder_level" INTEGER;

ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_reorder_level_check" CHECK ("reorder_level" IS NULL OR "reorder_level" BETWEEN 0 AND 100000);

-- Sold on Udozo, through resellers, at the shop, or more than one: a shop-only listing never shows on udozo.com.
ALTER TABLE "classified_listings" DROP CONSTRAINT "classified_listings_channel_check";
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_channel_check" CHECK ("on_shop" OR "resale" OR "pos_enabled_at" IS NOT NULL);

CREATE UNIQUE INDEX "classified_listings_seller_barcode_key" ON "classified_listings" ("customer_id", "barcode") WHERE "barcode" IS NOT NULL AND "status" <> 'deleted';
CREATE INDEX "classified_listings_pos_idx" ON "classified_listings" ("customer_id", "pos_enabled_at") WHERE "pos_enabled_at" IS NOT NULL;
