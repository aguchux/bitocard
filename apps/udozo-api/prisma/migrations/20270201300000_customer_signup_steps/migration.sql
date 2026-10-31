-- Step-by-step sign-up for store customers too (udozo.com): the email, then the mobile, are confirmed with codes before
-- the account exists. A row with a store is a customer's sign-up at that store's accounts; none, Seller HQ's.
ALTER TABLE "signup_verifications" ADD COLUMN "store_id" UUID;

CREATE INDEX "signup_verifications_store_id_email_idx" ON "signup_verifications"("store_id", "email");
