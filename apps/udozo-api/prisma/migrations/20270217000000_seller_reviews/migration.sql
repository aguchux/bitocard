-- Udozo: post-purchase reviews (docs/UDOZO_RATINGS_PLAN.md, phase 1). Every completed purchase (a released Safe pay
-- order, or a buy order the seller marked sold) is a purchase row: the right to review the seller once, within the
-- market's window, and to join the conversation on reviews of the same product from the same seller. Reviews are
-- positive, neutral (where the market allows it) or negative, public under the reviewer's first name and initial.

CREATE TABLE "classified_purchases" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "order_id" UUID,
    "buy_order_id" UUID,
    "listing_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "product_key" TEXT NOT NULL,
    "product_label" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "review_closes_at" TIMESTAMP(3) NOT NULL,
    "remind1_at" TIMESTAMP(3),
    "remind2_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_purchases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classified_purchases_source" CHECK (("source" = 'safe_pay' AND "order_id" IS NOT NULL AND "buy_order_id" IS NULL) OR ("source" = 'buy_order' AND "buy_order_id" IS NOT NULL AND "order_id" IS NULL)),
    CONSTRAINT "classified_purchases_parties" CHECK ("buyer_id" <> "seller_id")
);
CREATE UNIQUE INDEX "classified_purchases_order_id_key" ON "classified_purchases"("order_id");
CREATE UNIQUE INDEX "classified_purchases_buy_order_id_key" ON "classified_purchases"("buy_order_id");
CREATE INDEX "classified_purchases_buyer_id_completed_at_idx" ON "classified_purchases"("buyer_id", "completed_at");
CREATE INDEX "classified_purchases_seller_id_product_key_idx" ON "classified_purchases"("seller_id", "product_key");
CREATE INDEX "classified_purchases_completed_at_idx" ON "classified_purchases"("completed_at");
ALTER TABLE "classified_purchases" ADD CONSTRAINT "classified_purchases_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "classified_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_purchases" ADD CONSTRAINT "classified_purchases_buy_order_id_fkey" FOREIGN KEY ("buy_order_id") REFERENCES "classified_buy_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_purchases" ADD CONSTRAINT "classified_purchases_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_purchases" ADD CONSTRAINT "classified_purchases_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_purchases" ADD CONSTRAINT "classified_purchases_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "classified_reviews" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "source" TEXT NOT NULL,
    "product_key" TEXT NOT NULL,
    "product_label" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "aspects" JSONB NOT NULL DEFAULT '{}',
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "held_reason" TEXT,
    "removed_reason" TEXT,
    "edits" INTEGER NOT NULL DEFAULT 0,
    "versions" JSONB NOT NULL DEFAULT '[]',
    "edited_after_reply" BOOLEAN NOT NULL DEFAULT false,
    "locked_at" TIMESTAMP(3),
    "post_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classified_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classified_reviews_rating" CHECK ("rating" IN ('positive', 'neutral', 'negative')),
    CONSTRAINT "classified_reviews_status" CHECK ("status" IN ('published', 'held', 'removed', 'withdrawn'))
);
CREATE UNIQUE INDEX "classified_reviews_purchase_id_key" ON "classified_reviews"("purchase_id");
CREATE INDEX "classified_reviews_seller_id_status_created_at_idx" ON "classified_reviews"("seller_id", "status", "created_at");
CREATE INDEX "classified_reviews_reviewer_id_created_at_idx" ON "classified_reviews"("reviewer_id", "created_at");
CREATE INDEX "classified_reviews_status_created_at_idx" ON "classified_reviews"("status", "created_at");
ALTER TABLE "classified_reviews" ADD CONSTRAINT "classified_reviews_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "classified_purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_reviews" ADD CONSTRAINT "classified_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_reviews" ADD CONSTRAINT "classified_reviews_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_reviews" ADD CONSTRAINT "classified_reviews_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "classified_review_posts" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "purchase_id" UUID,
    "stance" TEXT,
    "reply_to" UUID,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'published',
    "removed_reason" TEXT,
    "edited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_review_posts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classified_review_posts_role" CHECK ("role" IN ('seller', 'reviewer', 'buyer')),
    CONSTRAINT "classified_review_posts_stance" CHECK (("role" = 'buyer') = ("stance" IS NOT NULL) AND ("stance" IS NULL OR "stance" IN ('agree', 'disagree', 'context'))),
    CONSTRAINT "classified_review_posts_status" CHECK ("status" IN ('published', 'removed', 'deleted'))
);
CREATE INDEX "classified_review_posts_review_id_created_at_idx" ON "classified_review_posts"("review_id", "created_at");
CREATE INDEX "classified_review_posts_author_id_created_at_idx" ON "classified_review_posts"("author_id", "created_at");
ALTER TABLE "classified_review_posts" ADD CONSTRAINT "classified_review_posts_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "classified_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_review_posts" ADD CONSTRAINT "classified_review_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_review_posts" ADD CONSTRAINT "classified_review_posts_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "classified_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "classified_review_reports" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "post_id" UUID,
    "reporter_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_review_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classified_review_reports_reason" CHECK ("reason" IN ('fake', 'not_a_buyer', 'offensive', 'personal_info', 'contact_or_links', 'threat_or_extortion', 'off_topic', 'other')),
    CONSTRAINT "classified_review_reports_status" CHECK ("status" IN ('open', 'upheld', 'dismissed'))
);
CREATE UNIQUE INDEX "classified_review_reports_once_key" ON "classified_review_reports"("reporter_id", "review_id", COALESCE("post_id", '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX "classified_review_reports_status_created_at_idx" ON "classified_review_reports"("status", "created_at");
CREATE INDEX "classified_review_reports_review_id_idx" ON "classified_review_reports"("review_id");
ALTER TABLE "classified_review_reports" ADD CONSTRAINT "classified_review_reports_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "classified_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_review_reports" ADD CONSTRAINT "classified_review_reports_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "classified_review_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_review_reports" ADD CONSTRAINT "classified_review_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A reviewer caught faking or extorting cannot review until then.
ALTER TABLE "classified_sellers" ADD COLUMN "reviews_blocked_until" TIMESTAMP(3);

-- Each market's review rules: whether Neutral is offered, how long a purchase can be reviewed, and how many counted
-- reviews before the positive share is shown.
ALTER TABLE "classified_market_settings" ADD COLUMN "reviews_neutral" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "classified_market_settings" ADD COLUMN "review_window_days" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "classified_market_settings" ADD COLUMN "review_min_shown" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "classified_market_settings" ADD CONSTRAINT "classified_market_settings_review_rules" CHECK ("review_window_days" BETWEEN 1 AND 180 AND "review_min_shown" BETWEEN 1 AND 50);

-- The last 12 months' completed purchases become purchases, open for review for the market's window from now's
-- point of view (their own completion plus 30 days). The product key matches productKeyOf: the brand and model
-- written as letters and digits, else the listing.
INSERT INTO "classified_purchases" ("id", "source", "order_id", "buy_order_id", "listing_id", "seller_id", "buyer_id", "country", "product_key", "product_label", "completed_at", "review_closes_at")
SELECT gen_random_uuid(), 'safe_pay', o."id", NULL, o."listing_id", o."seller_id", o."buyer_id", o."country",
  CASE WHEN b."value_text" IS NOT NULL AND m."value_text" IS NOT NULL AND lower(regexp_replace(b."value_text", '[^A-Za-z0-9]', '', 'g')) <> '' AND lower(regexp_replace(m."value_text", '[^A-Za-z0-9]', '', 'g')) <> ''
    THEN 'bm:' || lower(regexp_replace(b."value_text", '[^A-Za-z0-9]', '', 'g')) || ':' || lower(regexp_replace(m."value_text", '[^A-Za-z0-9]', '', 'g'))
    ELSE 'l:' || o."listing_id"::text END,
  CASE WHEN b."value_text" IS NOT NULL AND m."value_text" IS NOT NULL THEN left(b."value_text" || ' ' || m."value_text", 120) ELSE left(coalesce(l."title", 'A listing'), 120) END,
  o."released_at", o."released_at" + interval '30 days'
FROM "classified_orders" o
JOIN "classified_listings" l ON l."id" = o."listing_id"
LEFT JOIN "classified_features" bf ON bf."key" = 'brand'
LEFT JOIN "classified_listing_features" b ON b."listing_id" = o."listing_id" AND b."feature_id" = bf."id"
LEFT JOIN "classified_features" mf ON mf."key" = 'model'
LEFT JOIN "classified_listing_features" m ON m."listing_id" = o."listing_id" AND m."feature_id" = mf."id"
WHERE o."status" IN ('released', 'partly_refunded') AND o."kind" = 'direct' AND o."mode" = 'live' AND o."released_at" IS NOT NULL
  AND o."released_at" > CURRENT_TIMESTAMP - interval '12 months' AND o."buyer_id" <> o."seller_id";
