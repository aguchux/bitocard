-- Google sign-in for Afrippa's traders (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 5b), with Afrippa's own Google
-- client: a trader who signs up with Google has no password until they set one; their Google account is kept per store;
-- and each sign-in round trip says whose it is, so neither BitoCard's nor Afrippa's finishes the other's.
ALTER TABLE "customers" ALTER COLUMN "password_hash" DROP NOT NULL;
ALTER TABLE "customers" ADD COLUMN "google_subject" TEXT;
CREATE UNIQUE INDEX "customers_store_id_google_subject_key" ON "customers"("store_id", "google_subject");

ALTER TABLE "oauth_states" ADD COLUMN "platform" "Platform" NOT NULL DEFAULT 'bitocard';
