-- The account dashboard's message board (8 November 2026, the owner's request): posts Udozo's team writes to its
-- customers on udozo.com's account dashboard (/account), for one market or every market (country null), switched on
-- and off by admins and optionally between two dates; pinned ones first.
CREATE TABLE "classified_board_posts" (
    "id" UUID NOT NULL,
    "country" CHAR(2),
    "title" VARCHAR(100) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "tone" VARCHAR(10) NOT NULL DEFAULT 'news',
    "href" VARCHAR(500),
    "link_label" VARCHAR(40),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "classified_board_posts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classified_board_posts_tone_check" CHECK ("tone" IN ('news', 'tip', 'alert'))
);
CREATE INDEX "classified_board_posts_country_enabled_idx" ON "classified_board_posts"("country", "enabled");
