-- Afrippa's traders' accounts (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 5): customers of Afrippa's store, with
-- two-step sign-in required from day one, the methods Afrippa's operations allow (all of Afrippa and per market), and
-- a 24-hour hold on withdrawals after operations reset someone's two-step sign-in.
ALTER TYPE "CustomerCodePurpose" ADD VALUE IF NOT EXISTS 'mfa_setup';
ALTER TYPE "CustomerCodePurpose" ADD VALUE IF NOT EXISTS 'mfa_sign_in';

ALTER TABLE "customers"
  ADD COLUMN "mfa_method" "MfaMethod",
  ADD COLUMN "mfa_enabled_at" TIMESTAMP(3),
  ADD COLUMN "mfa_recovery_code_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "mfa_setup_method" "MfaMethod",
  ADD COLUMN "mfa_setup_secret_encrypted" TEXT,
  ADD COLUMN "mfa_setup_at" TIMESTAMP(3),
  ADD COLUMN "totp_secret_encrypted" TEXT,
  ADD COLUMN "totp_last_step" BIGINT,
  ADD COLUMN "withdrawals_held_until" TIMESTAMP(3);

ALTER TABLE "customer_sessions"
  ADD COLUMN "mfa_verified_at" TIMESTAMP(3),
  ADD COLUMN "mfa_reconfirmed_at" TIMESTAMP(3);

CREATE TABLE "afrippa_two_step_policies" (
  "market" VARCHAR(2) NOT NULL,
  "methods" "MfaMethod"[] NOT NULL,
  "updated_by_id" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "afrippa_two_step_policies_pkey" PRIMARY KEY ("market"),
  CONSTRAINT "afrippa_two_step_policies_methods_check" CHECK (cardinality("methods") >= 1)
);

-- Every method allowed for all of Afrippa to start with; operations narrow it (SMS is the weakest against SIM swaps).
INSERT INTO "afrippa_two_step_policies" ("market", "methods", "updated_at") VALUES ('WW', ARRAY['authenticator', 'email', 'sms']::"MfaMethod"[], CURRENT_TIMESTAMP);
