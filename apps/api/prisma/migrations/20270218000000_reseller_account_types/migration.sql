-- Resellers sell as an individual or as a business (22 November 2026, the owner's request). A business keeps its full
-- profile (legal name, address, phone, description); switching to business pauses an active account until the
-- business passes KYB, a check of its own (`business`) that reuses the owner's approved identity.
ALTER TYPE "VerificationMethod" ADD VALUE IF NOT EXISTS 'business';

ALTER TABLE "resellers"
  ADD COLUMN "account_type" TEXT NOT NULL DEFAULT 'individual',
  ADD COLUMN "legal_name" TEXT,
  ADD COLUMN "address_line" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "postal_code" TEXT,
  ADD COLUMN "business_phone" TEXT,
  ADD COLUMN "business_description" TEXT,
  ADD COLUMN "kyb_paused_at" TIMESTAMP(3);

ALTER TABLE "resellers" ADD CONSTRAINT "resellers_account_type_check" CHECK ("account_type" IN ('individual', 'business'));

-- Registered businesses already checked are business accounts.
UPDATE "resellers" SET "account_type" = 'business' WHERE "business_type" = 'registered';

-- A business check of an owner already verified asks only for the business and its documents.
ALTER TABLE "kyc_cases" ADD COLUMN "owner_verified" BOOLEAN NOT NULL DEFAULT false;
