-- CreateEnum
CREATE TYPE "VerificationSubject" AS ENUM ('reseller', 'customer');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('document', 'bvn');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('in_progress', 'approved', 'declined', 'in_review', 'expired');

-- AlterTable
ALTER TABLE "resellers" ADD COLUMN     "verified_at" TIMESTAMP(3),
ADD COLUMN     "verified_name" TEXT;

-- CreateTable
CREATE TABLE "identity_verifications" (
    "id" UUID NOT NULL,
    "subject" "VerificationSubject" NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "customer_reference" TEXT,
    "method" "VerificationMethod" NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_reference" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'in_progress',
    "url" TEXT,
    "country" CHAR(2) NOT NULL,
    "consent_at" TIMESTAMP(3) NOT NULL,
    "expected_name" TEXT,
    "verified_name" TEXT,
    "document_country" CHAR(2),
    "reason" TEXT,
    "requested_by_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "identity_verifications_reseller_id_subject_mode_customer_re_idx" ON "identity_verifications"("reseller_id", "subject", "mode", "customer_reference", "created_at");

-- CreateIndex
CREATE INDEX "identity_verifications_status_created_at_idx" ON "identity_verifications"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "identity_verifications_provider_provider_reference_key" ON "identity_verifications"("provider", "provider_reference");

-- AddForeignKey
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Customer checks name the reseller's customer; reseller checks never do.
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_subject_reference_check"
  CHECK (("subject" = 'customer') = ("customer_reference" IS NOT NULL));
