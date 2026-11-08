-- A hero banner may go without an image (8 November 2026, the owner's request): one linking to a listing, a brand, a
-- seller or a category then shows photos of its live listings, picked at random when udozo.com reads the reel.
ALTER TABLE "classified_hero_tiles" ALTER COLUMN "image_url" DROP NOT NULL;
