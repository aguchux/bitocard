-- Startup allowance: a restricted reseller account and its promotions expense counterpart.
ALTER TYPE "AccountKind" ADD VALUE 'reseller_allowance';
ALTER TYPE "AccountKind" ADD VALUE 'promotions';

-- Reserved accounts in Nigeria need the owner's BVN checked; the BVN is held encrypted only until the accounts are opened.
ALTER TABLE "resellers" ADD COLUMN "bvn_verified_at" TIMESTAMP(3);
ALTER TABLE "identity_verifications" ADD COLUMN "secret_encrypted" TEXT;
