-- A customer's country: chosen at sign-up on bitocard.com (a reseller's store: the reseller's country) and then fixed.
-- Their wallet, checkouts and prices are in its currency.
ALTER TABLE "customers" ADD COLUMN "country" CHAR(2);
ALTER TABLE "customers" ADD CONSTRAINT "customers_country_fkey" FOREIGN KEY ("country") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing customers: a reseller's store's customers take the reseller's country.
UPDATE "customers" c SET "country" = r."country"
FROM "stores" s JOIN "resellers" r ON r."id" = s."reseller_id"
WHERE s."id" = c."store_id" AND r."house" = false AND r."country" IS NOT NULL;

-- bitocard.com's customers take the market of their latest checkout, else of their latest wallet top-up.
UPDATE "customers" c SET "country" = (
  SELECT r."country" FROM "checkouts" k JOIN "resellers" r ON r."id" = k."reseller_id"
  WHERE k."customer_id" = c."id" AND r."country" IS NOT NULL ORDER BY k."created_at" DESC LIMIT 1
) WHERE c."country" IS NULL;
UPDATE "customers" c SET "country" = (
  SELECT r."country" FROM "payments" p JOIN "resellers" r ON r."id" = p."reseller_id"
  WHERE p."customer_id" = c."id" AND r."country" IS NOT NULL ORDER BY p."created_at" DESC LIMIT 1
) WHERE c."country" IS NULL;
