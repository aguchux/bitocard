-- BitoCard Shop search: Postgres full text over each listing (title, its features, its category, its description, in
-- that order of weight), kept by the API whenever a listing changes, plus trigram matching (pg_trgm) so a misspelt
-- search still finds what was meant. A search engine comes only if this becomes too slow.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "classified_listings" ADD COLUMN "search" tsvector;

CREATE INDEX "classified_listings_search_idx" ON "classified_listings" USING GIN ("search");
CREATE INDEX "classified_listings_title_trgm_idx" ON "classified_listings" USING GIN ("title" gin_trgm_ops);
-- Public pages read live listings of one country, newest or cheapest first.
CREATE INDEX "classified_listings_market_idx" ON "classified_listings" ("country", "status", "published_at" DESC);
CREATE INDEX "classified_listings_price_idx" ON "classified_listings" ("country", "status", "price_minor");
