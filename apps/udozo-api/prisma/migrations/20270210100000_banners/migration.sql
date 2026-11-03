-- Banner ads on udozo.com (3 November 2026, the owner's request): placed by Udozo's team, first above the account
-- pages' menu (`account_rail`), for one market or all of them, switched on and off by admins.
CREATE TABLE "classified_banners" (
    "id" UUID NOT NULL,
    "position" VARCHAR(40) NOT NULL,
    "country" CHAR(2),
    "image_url" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "alt" VARCHAR(120) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "note" TEXT,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "classified_banners_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "classified_banners_position_country_idx" ON "classified_banners"("position", "country");
