-- udozo.com's hero reel (8 November 2026, the owner's request): the home page's top, below the header, is a reel of
-- columns sliding past (dragged, swiped or scrolled too), each three rows high holding one, two (a third and two
-- thirds, either way up) or three banners, closely gapped and square-cornered. Admins place them per market or for
-- every market (Site > Hero slider); each banner links to a listing, a brand, a seller or any address.
CREATE TABLE "classified_hero_slides" (
    "id" UUID NOT NULL,
    "country" CHAR(2),
    "layout" VARCHAR(20) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "note" TEXT,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classified_hero_slides_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classified_hero_slides_layout_check" CHECK ("layout" IN ('full', 'third_two_thirds', 'two_thirds_third', 'thirds'))
);

CREATE INDEX "classified_hero_slides_country_position_idx" ON "classified_hero_slides"("country", "position");

CREATE TABLE "classified_hero_tiles" (
    "id" UUID NOT NULL,
    "slide_id" UUID NOT NULL,
    "slot" INTEGER NOT NULL,
    "image_url" TEXT NOT NULL,
    "alt" VARCHAR(120) NOT NULL,
    "link_kind" VARCHAR(20) NOT NULL,
    "link_target" TEXT NOT NULL,
    "ad" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "classified_hero_tiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classified_hero_tiles_slot_check" CHECK ("slot" BETWEEN 0 AND 2),
    CONSTRAINT "classified_hero_tiles_link_kind_check" CHECK ("link_kind" IN ('listing', 'brand', 'seller', 'url'))
);

CREATE UNIQUE INDEX "classified_hero_tiles_slide_id_slot_key" ON "classified_hero_tiles"("slide_id", "slot");

ALTER TABLE "classified_hero_tiles" ADD CONSTRAINT "classified_hero_tiles_slide_id_fkey" FOREIGN KEY ("slide_id") REFERENCES "classified_hero_slides"("id") ON DELETE CASCADE ON UPDATE CASCADE;
