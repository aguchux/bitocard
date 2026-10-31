-- BitoCard Shop, phase 1 step 2: listings, their feature values, photos and video, price history, and each market's
-- posting rules. Plan: docs/BITOCARD_CLASSIFIEDS_PLAN.md.

-- CreateTable
CREATE TABLE "classified_market_settings" (
    "country" CHAR(2) NOT NULL,
    "listing_days" INTEGER NOT NULL DEFAULT 30,
    "monthly_listing_limit" INTEGER NOT NULL DEFAULT 10,
    "first_listings_reviewed" INTEGER NOT NULL DEFAULT 3,
    "min_photos" INTEGER NOT NULL DEFAULT 4,
    "max_photos" INTEGER NOT NULL DEFAULT 12,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classified_market_settings_pkey" PRIMARY KEY ("country")
);

-- CreateTable
CREATE TABLE "classified_listings" (
    "id" UUID NOT NULL,
    "ref" BIGSERIAL NOT NULL,
    "customer_id" UUID NOT NULL,
    "category_id" UUID,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "state_id" UUID,
    "area_id" UUID,
    "title" TEXT,
    "slug" TEXT,
    "description" TEXT,
    "price_kind" TEXT NOT NULL DEFAULT 'fixed',
    "price_minor" BIGINT,
    "condition" TEXT,
    "delivery" TEXT NOT NULL DEFAULT 'none',
    "contact" TEXT NOT NULL DEFAULT 'chat',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "review_reason" TEXT,
    "submitted_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "sold_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classified_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classified_listing_features" (
    "listing_id" UUID NOT NULL,
    "feature_id" UUID NOT NULL,
    "value_text" TEXT,
    "value_number" DOUBLE PRECISION,

    CONSTRAINT "classified_listing_features_pkey" PRIMARY KEY ("listing_id","feature_id")
);

-- CreateTable
CREATE TABLE "classified_media" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "url" TEXT,
    "storage_key" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "content_hash" TEXT,
    "duration_ms" INTEGER,
    "poster_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classified_price_history" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "to" TIMESTAMP(3),

    CONSTRAINT "classified_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "classified_listings_ref_key" ON "classified_listings"("ref");

-- CreateIndex
CREATE INDEX "classified_listings_customer_id_status_idx" ON "classified_listings"("customer_id", "status");

-- CreateIndex
CREATE INDEX "classified_listings_country_status_state_id_area_id_idx" ON "classified_listings"("country", "status", "state_id", "area_id");

-- CreateIndex
CREATE INDEX "classified_listings_category_id_status_idx" ON "classified_listings"("category_id", "status");

-- CreateIndex
CREATE INDEX "classified_listings_status_expires_at_idx" ON "classified_listings"("status", "expires_at");

-- CreateIndex
CREATE INDEX "classified_listing_features_feature_id_value_number_idx" ON "classified_listing_features"("feature_id", "value_number");

-- CreateIndex
CREATE INDEX "classified_listing_features_feature_id_value_text_idx" ON "classified_listing_features"("feature_id", "value_text");

-- CreateIndex
CREATE INDEX "classified_media_listing_id_kind_position_idx" ON "classified_media"("listing_id", "kind", "position");

-- CreateIndex
CREATE INDEX "classified_media_content_hash_idx" ON "classified_media"("content_hash");

-- CreateIndex
CREATE INDEX "classified_price_history_listing_id_from_idx" ON "classified_price_history"("listing_id", "from");

-- AddForeignKey
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "classified_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "classified_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "classified_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_listing_features" ADD CONSTRAINT "classified_listing_features_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_listing_features" ADD CONSTRAINT "classified_listing_features_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "classified_features"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_media" ADD CONSTRAINT "classified_media_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_price_history" ADD CONSTRAINT "classified_price_history_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Checks the database enforces whatever the code does.
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_status_check" CHECK ("status" IN ('draft', 'pending_review', 'active', 'sold', 'expired', 'rejected', 'removed', 'deleted'));
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_price_kind_check" CHECK ("price_kind" IN ('fixed', 'negotiable', 'on_request'));
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_price_check" CHECK ("price_minor" IS NULL OR "price_minor" > 0);
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_condition_check" CHECK ("condition" IS NULL OR "condition" IN ('new', 'used', 'untested', 'parts'));
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_delivery_check" CHECK ("delivery" IN ('none', 'state', 'nationwide'));
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_contact_check" CHECK ("contact" IN ('chat', 'phone', 'both'));
-- Anything past a draft has everything a buyer needs.
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_complete_check" CHECK (
  "status" = 'draft' OR ("category_id" IS NOT NULL AND "area_id" IS NOT NULL AND "state_id" IS NOT NULL AND "title" IS NOT NULL AND "condition" IS NOT NULL AND ("price_kind" = 'on_request' OR "price_minor" IS NOT NULL)));
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_counts_check" CHECK ("views" >= 0 AND "leads" >= 0);
ALTER TABLE "classified_listing_features" ADD CONSTRAINT "classified_listing_features_value_check" CHECK (("value_text" IS NULL) <> ("value_number" IS NULL));
ALTER TABLE "classified_media" ADD CONSTRAINT "classified_media_kind_check" CHECK ("kind" IN ('photo', 'video'));
ALTER TABLE "classified_media" ADD CONSTRAINT "classified_media_status_check" CHECK ("status" IN ('processing', 'ready', 'failed'));
ALTER TABLE "classified_market_settings" ADD CONSTRAINT "classified_market_settings_check" CHECK (
  "listing_days" BETWEEN 1 AND 365 AND "monthly_listing_limit" BETWEEN 1 AND 10000 AND "first_listings_reviewed" BETWEEN 0 AND 100
  AND "min_photos" BETWEEN 1 AND 30 AND "max_photos" BETWEEN "min_photos" AND 30);
-- One video per listing.
CREATE UNIQUE INDEX "classified_media_one_video_key" ON "classified_media"("listing_id") WHERE "kind" = 'video';
-- Listing numbers start at 100001, so addresses look alike from the first one.
ALTER SEQUENCE "classified_listings_ref_seq" RESTART WITH 100001;

-- Nigeria's posting rules (the defaults: 30 days, 10 listings per top category in 30 days, a new seller's first 3 reviewed,
-- 4 to 12 photos).
INSERT INTO "classified_market_settings" ("country", "updated_at") VALUES ('NG', CURRENT_TIMESTAMP);
