-- BitoCard Verify (verify.bitocard.com): own KYC and KYB with human review, for every African country.

CREATE TYPE "ResellerBusinessType" AS ENUM ('unregistered', 'registered');
CREATE TYPE "KycCaseStatus" AS ENUM ('draft', 'submitted', 'approved', 'declined', 'resubmit');

ALTER TABLE "resellers"
  ADD COLUMN "business_type" "ResellerBusinessType",
  ADD COLUMN "registered_name" TEXT,
  ADD COLUMN "registration_number" TEXT,
  ADD COLUMN "business_address" TEXT,
  ADD COLUMN "kyb_verified_at" TIMESTAMP(3);

-- Who checks identities in each market: BitoCard Verify in Africa, Didit elsewhere.
ALTER TABLE "countries" ADD COLUMN "identity_provider" TEXT NOT NULL DEFAULT 'didit';
ALTER TABLE "countries" ADD CONSTRAINT "countries_identity_provider_check" CHECK ("identity_provider" IN ('bitocard', 'didit'));
UPDATE "countries" SET "identity_provider" = 'bitocard' WHERE "code" IN (
  'DZ','AO','BJ','BW','BF','BI','CV','CM','CF','TD','KM','CD','CG','CI','DJ','EG','GQ','ER','SZ','ET','GA','GM','GH','GN','GW',
  'KE','LS','LR','LY','MG','MW','ML','MR','MU','MA','MZ','NA','NE','NG','RW','ST','SN','SC','SL','SO','ZA','SS','SD','TZ','TG',
  'TN','UG','ZM','ZW'
);

CREATE TABLE "kyc_cases" (
    "id" UUID NOT NULL,
    "verification_id" UUID NOT NULL,
    "subject" "VerificationSubject" NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "country" CHAR(2) NOT NULL,
    "reseller_id" UUID NOT NULL,
    "customer_reference" TEXT,
    "store_id" UUID,
    "status" "KycCaseStatus" NOT NULL DEFAULT 'draft',
    "consent_at" TIMESTAMP(3),
    "business_type" "ResellerBusinessType",
    "registered_name" TEXT,
    "registration_number" TEXT,
    "business_address" TEXT,
    "id_type" TEXT,
    "id_number_encrypted" TEXT,
    "id_fingerprint" TEXT,
    "full_name" TEXT,
    "date_of_birth" TEXT,
    "liveness_steps" TEXT[],
    "reviewer" TEXT,
    "resubmit_items" TEXT[],
    "reason" TEXT,
    "note" TEXT,
    "verified_name" TEXT,
    "decided_by_id" UUID,
    "decided_realm" TEXT,
    "return_url" TEXT,
    "submitted_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "purge_after" TIMESTAMP(3),
    "purged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kyc_cases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kyc_cases_kind_check" CHECK ("kind" IN ('kyc', 'kyb')),
    CONSTRAINT "kyc_cases_reviewer_check" CHECK ("reviewer" IS NULL OR "reviewer" IN ('admin', 'reseller'))
);
CREATE UNIQUE INDEX "kyc_cases_verification_id_key" ON "kyc_cases"("verification_id");
CREATE INDEX "kyc_cases_status_reviewer_submitted_at_idx" ON "kyc_cases"("status", "reviewer", "submitted_at");
CREATE INDEX "kyc_cases_reseller_id_subject_status_idx" ON "kyc_cases"("reseller_id", "subject", "status");
CREATE INDEX "kyc_cases_id_fingerprint_idx" ON "kyc_cases"("id_fingerprint");
CREATE INDEX "kyc_cases_purge_after_idx" ON "kyc_cases"("purge_after");
ALTER TABLE "kyc_cases" ADD CONSTRAINT "kyc_cases_verification_id_fkey" FOREIGN KEY ("verification_id") REFERENCES "identity_verifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kyc_cases" ADD CONSTRAINT "kyc_cases_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "kyc_documents" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kyc_documents_case_id_kind_key" ON "kyc_documents"("case_id", "kind");
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "kyc_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "kyc_sessions" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kyc_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kyc_sessions_kind_check" CHECK ("kind" IN ('handoff', 'session'))
);
CREATE UNIQUE INDEX "kyc_sessions_token_hash_key" ON "kyc_sessions"("token_hash");
CREATE INDEX "kyc_sessions_case_id_idx" ON "kyc_sessions"("case_id");
ALTER TABLE "kyc_sessions" ADD CONSTRAINT "kyc_sessions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "kyc_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
