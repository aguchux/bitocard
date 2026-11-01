-- Buyers reach a seller by chat and by phone (calls in the browser, call backs, contact requests) unless the seller
-- chooses otherwise: new listings start with both, and listings left on the old default (chat only) move to both, as
-- sellers who chose it did so before calls existed.
ALTER TABLE "classified_listings" ALTER COLUMN "contact" SET DEFAULT 'both';
UPDATE "classified_listings" SET "contact" = 'both' WHERE "contact" = 'chat';
