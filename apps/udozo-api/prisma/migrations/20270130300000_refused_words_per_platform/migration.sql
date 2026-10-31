-- The refused words lifted for Afrippa (docs/CRYPTO_SPINOFF_PLAN.md, instruments): BitoCard Shop's list becomes one
-- list per product. BitoCard's words stay BitoCard's; Afrippa's admins keep their own (refusing ad terms, nicknames and
-- feedback), and neither product reads the other's.
ALTER TABLE "classified_prohibited_words" ADD COLUMN "platform" "Platform" NOT NULL DEFAULT 'bitocard';
DROP INDEX "classified_prohibited_words_key";
CREATE UNIQUE INDEX "classified_prohibited_words_key" ON "classified_prohibited_words"("platform", coalesce("country", ''), "phrase");
DROP INDEX "classified_prohibited_words_country_idx";
CREATE INDEX "classified_prohibited_words_platform_country_idx" ON "classified_prohibited_words"("platform", "country");
