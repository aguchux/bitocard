-- An admin can let a reseller go live without the owner's identity check (who, when and why; audited too).
ALTER TABLE "resellers" ADD COLUMN "identity_waived_at" TIMESTAMP(3);
ALTER TABLE "resellers" ADD COLUMN "identity_waived_by" UUID;
ALTER TABLE "resellers" ADD COLUMN "identity_waiver_reason" TEXT;
