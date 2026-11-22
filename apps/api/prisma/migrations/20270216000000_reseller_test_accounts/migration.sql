-- The identity check is always required to go live (22 November 2026, the owner's decision): admins can no longer waive
-- it. Only an account an admin marks as a test account may be activated without it, and a test account never moves
-- money out (payouts, the startup allowance and bank account numbers still need the check itself). The sandbox needs
-- no check at all.

ALTER TABLE "resellers" ADD COLUMN "test_account_at" TIMESTAMPTZ(3);
ALTER TABLE "resellers" ADD COLUMN "test_account_by" UUID;
ALTER TABLE "resellers" ADD COLUMN "test_account_reason" TEXT;

-- Resellers selling live on a waiver, without a passed check, go back to pending until they pass it.
UPDATE "resellers"
SET "status" = 'pending'
WHERE "identity_waived_at" IS NOT NULL AND "verified_at" IS NULL AND "status" = 'active' AND "house" = false AND "platform" = 'bitocard';

-- The waiver columns are left out of the Prisma schema and dropped in a later release, so an API still running the
-- previous release during a deploy never meets a missing column.
