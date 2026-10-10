-- Who is asked for the identity check at checkout. The market's category rule is the base everywhere; on top of it:
-- BitoCard turns checks off for bitocard.com customers per supplier, for the whole store or for one customer, or asks
-- only once some days have passed since a customer's first purchase; a reseller turns them off for their own store's
-- customers, all of them or one at a time. Nobody can mark a customer as checked: only the check itself does that.

-- bitocard.com customers buying products routed to this supplier are asked (the default) or not.
ALTER TABLE "suppliers" ADD COLUMN "customer_verification" BOOLEAN NOT NULL DEFAULT true;

-- The store's customers are asked where the market requires it (the default) or never. bitocard.com's is BitoCard's.
ALTER TABLE "stores" ADD COLUMN "customer_verification" BOOLEAN NOT NULL DEFAULT true;
-- bitocard.com only: ask only once this many days have passed since the customer's first paid purchase.
ALTER TABLE "stores" ADD COLUMN "verification_grace_days" INTEGER;
ALTER TABLE "stores" ADD CONSTRAINT "stores_verification_grace_days_check" CHECK ("verification_grace_days" IS NULL OR "verification_grace_days" BETWEEN 1 AND 365);

-- This customer is asked (the default) or not; set by their store's owner (BitoCard for bitocard.com).
ALTER TABLE "customers" ADD COLUMN "identity_check" BOOLEAN NOT NULL DEFAULT true;
