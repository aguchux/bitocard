-- Resellers' two-step sign-in: authenticator app, emailed code or text message, chosen per person; required where an
-- admin switches `reseller_two_step` on (global, market or reseller). Off for everyone until then.
ALTER TYPE "CodePurpose" ADD VALUE IF NOT EXISTS 'mfa_setup';
ALTER TYPE "CodePurpose" ADD VALUE IF NOT EXISTS 'mfa_sign_in';

CREATE TYPE "MfaMethod" AS ENUM ('authenticator', 'email', 'sms');

ALTER TABLE "users"
  ADD COLUMN "mfa_method" "MfaMethod",
  ADD COLUMN "mfa_enabled_at" TIMESTAMP(3),
  ADD COLUMN "mfa_recovery_code_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "mfa_setup_method" "MfaMethod",
  ADD COLUMN "mfa_setup_secret_encrypted" TEXT,
  ADD COLUMN "mfa_setup_at" TIMESTAMP(3);

-- Sessions from before stay as they are: nobody has two-step on yet.
ALTER TABLE "sessions" ADD COLUMN "mfa_verified_at" TIMESTAMP(3);

ALTER TABLE "countries" ADD COLUMN "reseller_mfa_methods" "MfaMethod"[] DEFAULT ARRAY['authenticator', 'email', 'sms']::"MfaMethod"[];
