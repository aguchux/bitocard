-- The hero reel's banners can link to a category too (8 November 2026, the owner's request): its page in the market
-- being viewed, or across countries on the global home.
ALTER TABLE "classified_hero_tiles" DROP CONSTRAINT "classified_hero_tiles_link_kind_check";
ALTER TABLE "classified_hero_tiles" ADD CONSTRAINT "classified_hero_tiles_link_kind_check" CHECK ("link_kind" IN ('listing', 'brand', 'seller', 'category', 'url'));
