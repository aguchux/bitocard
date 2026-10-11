-- Every reseller and customer keeps a US dollar wallet beside their country's: conversions between them go through
-- BitoCard's currency exchange position, and a checkout paid from the US dollar wallet records what it took.
ALTER TYPE "AccountKind" ADD VALUE 'currency_exchange';

ALTER TABLE "checkouts" ADD COLUMN "wallet_currency" CHAR(3);
ALTER TABLE "checkouts" ADD COLUMN "wallet_amount_minor" BIGINT;
