-- Uploaded files are each product's: Afrippa's admins upload to Afrippa's own File storage settings and see only
-- Afrippa's files; BitoCard's admins and resellers only BitoCard's (docs/CRYPTO_SPINOFF_PLAN.md).
ALTER TABLE "media_assets" ADD COLUMN "platform" "Platform" NOT NULL DEFAULT 'bitocard';
