-- In stock and out of stock (6 November 2026, the owner's request): every listing's stock is tracked from posting, a
-- new listing starts at none (out of stock) until its seller says how many they have, and a live listing with none
-- stays on Udozo for 90 days from then, after which the `classifieds` job (Anjio) takes it off unless it is restocked.
-- Listings already posted keep the stock they have.
ALTER TABLE "classified_listings" ALTER COLUMN "stock" SET DEFAULT 0;

-- When a posted listing's stock reached none (null while it has some, and for drafts).
ALTER TABLE "classified_listings" ADD COLUMN "out_of_stock_at" TIMESTAMP(3);

-- Why an expired listing left the market: `out_of_stock` when Anjio took it off after 90 days without stock (null
-- for a listing whose period ran out).
ALTER TABLE "classified_listings" ADD COLUMN "expired_reason" VARCHAR(20);
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_expired_reason_check" CHECK ("expired_reason" IS NULL OR "expired_reason" = 'out_of_stock');

-- Posted listings already at none (none live today, as stock was at least one) start their clock now.
UPDATE "classified_listings" SET "out_of_stock_at" = NOW() WHERE "stock" = 0 AND "status" IN ('active', 'pending_review', 'rejected');
UPDATE "classified_listings" SET "expires_at" = NOW() + INTERVAL '90 days' WHERE "stock" = 0 AND "status" = 'active';
