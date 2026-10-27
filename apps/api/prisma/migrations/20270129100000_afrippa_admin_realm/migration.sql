-- Afrippa's own admins (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 1): a realm of their own, so their accounts, sessions,
-- authenticators and step-up are apart from BitoCard's, and an audit trail of their own.
ALTER TYPE "Realm" ADD VALUE IF NOT EXISTS 'afrippa_admin';

ALTER TABLE "audit_logs" ADD COLUMN "platform" "Platform" NOT NULL DEFAULT 'bitocard';
CREATE INDEX "audit_logs_platform_created_at_idx" ON "audit_logs"("platform", "created_at");
