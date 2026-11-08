-- Continue with Facebook on udozo.com and Seller HQ (8 November 2026, the owner's request).
-- A sign-in round trip says whose it is, so a Google one never finishes as Facebook's or the other way round.
ALTER TABLE "oauth_states" ADD COLUMN "provider" VARCHAR(20) NOT NULL DEFAULT 'google';
-- A customer who continued with Facebook: the Facebook account's app-scoped id, one account per store.
ALTER TABLE "customers" ADD COLUMN "facebook_subject" TEXT;
CREATE UNIQUE INDEX "customers_store_id_facebook_subject_key" ON "customers"("store_id", "facebook_subject");
