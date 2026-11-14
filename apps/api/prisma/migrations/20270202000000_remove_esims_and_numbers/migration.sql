-- eSIMs and virtual phone numbers are gone from BitoCard for good (the owner's decision, 14 November 2026): every past
-- order of them, everything hanging off those orders, their ledger entries (their effect on balances reversed first, so
-- the books still balance), their tables, catalogue, suppliers and settings, and the two categories themselves. Also
-- the last crypto settings left on BitoCard's resellers (Afrippa's own stay).

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. What goes: worked out once, into helper tables dropped at the end.
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE "_rm_suppliers" ("code" TEXT PRIMARY KEY);
INSERT INTO "_rm_suppliers" VALUES ('didww'), ('esim_access'), ('esimerge'), ('airalo'), ('esim_go'), ('telnyx'), ('vonage'), ('twilio'), ('plivo');

CREATE TABLE "_rm_products" ("id" UUID PRIMARY KEY, "key" TEXT NOT NULL, "brand" TEXT NOT NULL);
INSERT INTO "_rm_products"
SELECT "id", "key", "brand" FROM "products" WHERE "category"::text IN ('esim', 'virtual_numbers')
UNION
SELECT p."id", p."key", p."brand" FROM "products" p JOIN "supplier_products" o ON o."product_id" = p."id" WHERE o."supplier_code" IN (SELECT "code" FROM "_rm_suppliers")
  AND NOT EXISTS (SELECT 1 FROM "supplier_products" other WHERE other."product_id" = p."id" AND other."supplier_code" NOT IN (SELECT "code" FROM "_rm_suppliers"));

CREATE TABLE "_rm_quotes" ("id" UUID PRIMARY KEY);
INSERT INTO "_rm_quotes" SELECT "id" FROM "quotes" WHERE "product_id" IN (SELECT "id" FROM "_rm_products") OR "supplier_code" IN (SELECT "code" FROM "_rm_suppliers");

CREATE TABLE "_rm_orders" ("id" UUID PRIMARY KEY, "hold_id" UUID, "fee_charge_id" UUID);
INSERT INTO "_rm_orders"
SELECT "id", "hold_id", "fee_charge_id" FROM "orders"
WHERE "product_id" IN (SELECT "id" FROM "_rm_products") OR "quote_id" IN (SELECT "id" FROM "_rm_quotes") OR "supplier_code" IN (SELECT "code" FROM "_rm_suppliers");

CREATE TABLE "_rm_checkouts" ("id" UUID PRIMARY KEY, "payment_id" UUID, "fee_charge_id" UUID);
INSERT INTO "_rm_checkouts"
SELECT "id", "payment_id", "fee_charge_id" FROM "checkouts" WHERE "order_id" IN (SELECT "id" FROM "_rm_orders") OR "quote_id" IN (SELECT "id" FROM "_rm_quotes");

CREATE TABLE "_rm_payments" ("id" UUID PRIMARY KEY);
INSERT INTO "_rm_payments" SELECT DISTINCT "payment_id" FROM "_rm_checkouts" WHERE "payment_id" IS NOT NULL;

CREATE TABLE "_rm_fees" ("id" UUID PRIMARY KEY, "reference" TEXT NOT NULL, "hold_id" UUID);
INSERT INTO "_rm_fees"
SELECT "id", "reference", "hold_id" FROM "fee_charges"
WHERE "id" IN (SELECT "fee_charge_id" FROM "_rm_orders" UNION SELECT "fee_charge_id" FROM "_rm_checkouts")
   OR ("source_type" = 'order' AND "source_id" IN (SELECT "id"::text FROM "_rm_orders"))
   OR ("source_type" = 'payment' AND "source_id" IN (SELECT "id"::text FROM "_rm_payments"))
   OR "category"::text IN ('esim', 'virtual_numbers');

CREATE TABLE "_rm_chargebacks" ("id" UUID PRIMARY KEY, "hold_id" UUID);
INSERT INTO "_rm_chargebacks" SELECT "id", "hold_id" FROM "chargebacks" WHERE "payment_id" IN (SELECT "id" FROM "_rm_payments");

CREATE TABLE "_rm_disputes" ("id" UUID PRIMARY KEY);
INSERT INTO "_rm_disputes"
SELECT "id" FROM "disputes"
WHERE "order_id" IN (SELECT "id" FROM "_rm_orders") OR "checkout_id" IN (SELECT "id" FROM "_rm_checkouts")
   OR "payment_id" IN (SELECT "id" FROM "_rm_payments") OR "chargeback_id" IN (SELECT "id" FROM "_rm_chargebacks");

-- Holds: each order's (`order:<id>`), its fees', its chargebacks', and every eSIM top-up, number renewal and SMS hold.
CREATE TABLE "_rm_holds" ("id" UUID PRIMARY KEY);
INSERT INTO "_rm_holds"
SELECT "id" FROM "holds"
WHERE "id" IN (SELECT "hold_id" FROM "_rm_orders" UNION SELECT "hold_id" FROM "_rm_fees" UNION SELECT "hold_id" FROM "_rm_chargebacks")
   OR "reference" IN (SELECT 'order:' || "id" FROM "_rm_orders")
   OR "reference" LIKE 'esim\_top\_up:%' OR "reference" LIKE 'number\_renewal:%' OR "reference" LIKE 'sms:%';

-- Earnings lots of store checkout sales (`order:<id>`) and of eSIM top-ups.
CREATE TABLE "_rm_lots" ("id" UUID PRIMARY KEY);
INSERT INTO "_rm_lots" SELECT "id" FROM "earnings_lots" WHERE "reference" IN (SELECT 'order:' || "id" FROM "_rm_orders") OR "reference" LIKE 'esim\_top\_up%';

-- Journal entries, by the references the code posts them under.
CREATE TABLE "_rm_refs" ("ref" TEXT PRIMARY KEY);
INSERT INTO "_rm_refs"
SELECT 'order_cost:' || "id" FROM "_rm_orders"
UNION SELECT 'order_refund:' || "id" FROM "_rm_orders"
UNION SELECT 'earnings:order:' || "id" FROM "_rm_orders"
UNION SELECT 'conversion:hold:order:' || "id" FROM "_rm_orders"
UNION SELECT 'payment:' || "id" FROM "_rm_payments"
UNION SELECT 'checkout_refund:' || "id" FROM "_rm_checkouts"
UNION SELECT 'wallet_purchase:' || "id" FROM "_rm_checkouts"
UNION SELECT "reference" FROM "_rm_fees"
UNION SELECT 'fee:refund:' || "id" FROM "_rm_fees"
UNION SELECT 'conversion:hold:' || "reference" || ':hold' FROM "_rm_fees"
UNION SELECT 'hold:' || "id" FROM "_rm_holds"
UNION SELECT 'hold_capture:' || "id" FROM "_rm_holds"
UNION SELECT 'hold_release:' || "id" FROM "_rm_holds"
UNION SELECT 'earnings_release:' || "id" FROM "_rm_lots"
UNION SELECT 'chargeback:lost:' || "id" FROM "_rm_chargebacks"
UNION SELECT 'dispute:' || "id" || ':credit' FROM "_rm_disputes"
UNION SELECT 'supplier_funding:' || "id" FROM "supplier_funding_movements" WHERE "supplier_code" IN (SELECT "code" FROM "_rm_suppliers");

CREATE TABLE "_rm_entries" ("id" UUID PRIMARY KEY);
INSERT INTO "_rm_entries"
SELECT "id" FROM "journal_entries"
WHERE "reference" IN (SELECT "ref" FROM "_rm_refs")
   OR "reference" LIKE 'esim\_top\_up%'
   OR "reference" LIKE 'earnings:esim\_top\_up%'
   OR "reference" LIKE 'number\_renewal:%'
   OR "reference" LIKE 'number\_renewal\_cost:%'
   OR "reference" LIKE 'sms:%'
   OR "reference" LIKE 'sms\_cost:%'
   OR "reference" LIKE 'conversion:hold:esim\_top\_up:%'
   OR "reference" LIKE 'conversion:hold:number\_renewal:%'
   OR "reference" LIKE 'conversion:hold:sms:%';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. The ledger: undo each entry's effect on its accounts (as LedgerService applies it: a posting adds its amount to a
--    debit-normal account and takes it from any other), then delete its postings and the entry. Every entry balances,
--    so the books still do. A reseller or customer balance that would go below zero stops the migration here.
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE "_rm_deltas" ("account_id" UUID PRIMARY KEY, "delta" BIGINT NOT NULL);
INSERT INTO "_rm_deltas"
SELECT p."account_id",
       SUM(CASE WHEN a."kind"::text IN ('reseller_owed', 'provider_balance', 'processing_fees', 'supplier_float', 'cost_of_sales', 'promotions', 'crypto_custody', 'crypto_promotions') THEN p."amount_minor" ELSE -p."amount_minor" END)
FROM "ledger_postings" p JOIN "ledger_accounts" a ON a."id" = p."account_id"
WHERE p."entry_id" IN (SELECT "id" FROM "_rm_entries")
GROUP BY p."account_id";

DO $$
DECLARE short TEXT;
BEGIN
  SELECT string_agg(a."id"::text || ' (' || a."kind"::text || ' ' || a."currency" || ')', ', ') INTO short
  FROM "ledger_accounts" a JOIN "_rm_deltas" d ON d."account_id" = a."id"
  WHERE a."non_negative" AND a."balance_minor" - d."delta" < 0;
  IF short IS NOT NULL THEN
    RAISE EXCEPTION 'Removing eSIM and number entries would take these accounts below zero: %', short;
  END IF;
END $$;

UPDATE "ledger_accounts" a SET "balance_minor" = a."balance_minor" - d."delta" FROM "_rm_deltas" d WHERE a."id" = d."account_id";
DELETE FROM "ledger_postings" WHERE "entry_id" IN (SELECT "id" FROM "_rm_entries");
DELETE FROM "journal_entries" WHERE "id" IN (SELECT "id" FROM "_rm_entries");

-- Invoice lines of fees that are gone, taken out of their invoices' totals.
UPDATE "invoices" i
SET "total_minor" = i."total_minor" - l."amount", "paid_minor" = i."paid_minor" - l."paid"
FROM (SELECT "invoice_id", SUM("amount_minor") AS "amount", SUM("paid_minor") AS "paid" FROM "invoice_lines" WHERE "reference" IN (SELECT "ref" FROM "_rm_refs") GROUP BY "invoice_id") l
WHERE i."id" = l."invoice_id";
DELETE FROM "invoice_lines" WHERE "reference" IN (SELECT "ref" FROM "_rm_refs");

DELETE FROM "holds" WHERE "id" IN (SELECT "id" FROM "_rm_holds");
DELETE FROM "earnings_lots" WHERE "id" IN (SELECT "id" FROM "_rm_lots");
DELETE FROM "fee_charges" WHERE "id" IN (SELECT "id" FROM "_rm_fees");
DELETE FROM "supplier_funding_movements" WHERE "supplier_code" IN (SELECT "code" FROM "_rm_suppliers");

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. The orders and everything about them.
-- ---------------------------------------------------------------------------------------------------------------------

DELETE FROM "disputes" WHERE "id" IN (SELECT "id" FROM "_rm_disputes");
DELETE FROM "chargebacks" WHERE "id" IN (SELECT "id" FROM "_rm_chargebacks");
-- Help tickets stay (they are the customer's words), without the link to an order that is gone.
UPDATE "support_tickets" SET "order_id" = NULL WHERE "order_id" IN (SELECT "id" FROM "_rm_orders");
UPDATE "support_tickets" SET "checkout_id" = NULL WHERE "checkout_id" IN (SELECT "id" FROM "_rm_checkouts");
DELETE FROM "supplier_webhooks" WHERE "order_id" IN (SELECT "id" FROM "_rm_orders") OR "supplier_code" IN (SELECT "code" FROM "_rm_suppliers");

DELETE FROM "events"
WHERE "type" IN ('number.renewed', 'number.expired', 'number.deleted', 'number.sms_received', 'esim.updated')
   OR ("payload"::jsonb #>> '{data,object,id}') IN (SELECT "id"::text FROM "_rm_orders" UNION SELECT "id"::text FROM "_rm_disputes");
UPDATE "webhook_endpoints"
SET "events" = array(SELECT e FROM unnest("events") AS e WHERE e NOT IN ('number.renewed', 'number.expired', 'number.deleted', 'number.sms_received', 'esim.updated'))
WHERE "events" && ARRAY['number.renewed', 'number.expired', 'number.deleted', 'number.sms_received', 'esim.updated'];

DELETE FROM "notifications"
WHERE "type" IN ('number.expiring', 'number.renewal_failed', 'number.expired', 'number.deleted', 'admin.esim.top_up_unclear', 'customer.esim.low_data', 'customer.esim.expiring')
   OR EXISTS (SELECT 1 FROM "_rm_orders" r WHERE "notifications"."link" LIKE '%' || r."id" || '%')
   OR EXISTS (SELECT 1 FROM "_rm_checkouts" r WHERE "notifications"."link" LIKE '%' || r."id" || '%');
DELETE FROM "notification_preferences" WHERE "type" IN ('number.expiring', 'number.renewal_failed', 'number.expired', 'number.deleted', 'admin.esim.top_up_unclear', 'customer.esim.low_data', 'customer.esim.expiring');

DROP TABLE "esim_top_ups";
DROP TABLE "esims";
DROP TABLE "number_messages";
DROP TABLE "virtual_numbers";

DELETE FROM "checkouts" WHERE "id" IN (SELECT "id" FROM "_rm_checkouts");
DELETE FROM "payments" WHERE "id" IN (SELECT "id" FROM "_rm_payments");
-- Attempts, deliveries, access links and their codes go with their orders.
DELETE FROM "orders" WHERE "id" IN (SELECT "id" FROM "_rm_orders");
DELETE FROM "quotes" WHERE "id" IN (SELECT "id" FROM "_rm_quotes");

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. The catalogue, suppliers and settings.
-- ---------------------------------------------------------------------------------------------------------------------

-- A single product store selling one of them becomes an All-in-one store, on its starting page.
UPDATE "stores"
SET "template" = 'all_in_one', "variant" = 'classic', "theme" = 'navy_pink', "focus" = NULL, "home_draft" = NULL, "home_published" = NULL, "home_published_at" = NULL
WHERE "focus" IN (SELECT "key" FROM "_rm_products");

-- Brands only these products had.
DELETE FROM "brands" b WHERE b."slug" IN (SELECT "brand" FROM "_rm_products") AND NOT EXISTS (SELECT 1 FROM "products" p WHERE p."brand" = b."slug" AND p."id" NOT IN (SELECT "id" FROM "_rm_products"));
DELETE FROM "brand_assets" WHERE "slug" = 'airalo';

DELETE FROM "pricing_rules"
WHERE "category"::text IN ('esim', 'virtual_numbers') OR "product_id" IN (SELECT "id" FROM "_rm_products") OR "supplier_code" IN (SELECT "code" FROM "_rm_suppliers");
DELETE FROM "reseller_markups" WHERE "category"::text IN ('esim', 'virtual_numbers') OR "product_id" IN (SELECT "id" FROM "_rm_products");
DELETE FROM "fee_rules" WHERE "category"::text IN ('esim', 'virtual_numbers');
-- Listings, offers and resellers' own offers go with their products.
DELETE FROM "supplier_products" WHERE "supplier_code" IN (SELECT "code" FROM "_rm_suppliers");
DELETE FROM "products" WHERE "id" IN (SELECT "id" FROM "_rm_products");

DELETE FROM "country_categories" WHERE "category"::text IN ('esim', 'virtual_numbers');
DELETE FROM "category_presentations" WHERE "category"::text IN ('esim', 'virtual_numbers');
DELETE FROM "supplier_markets" WHERE "category"::text IN ('esim', 'virtual_numbers') OR "supplier_code" IN (SELECT "code" FROM "_rm_suppliers");
DELETE FROM "suppliers" WHERE "code" IN (SELECT "code" FROM "_rm_suppliers");
-- Africa's Talking stays, for airtime and data.
UPDATE "suppliers" SET "categories" = array_remove(array_remove("categories", 'esim'), 'virtual_numbers')
WHERE "categories" && ARRAY['esim', 'virtual_numbers']::"ProductCategory"[];

DELETE FROM "reseller_connections" WHERE "integration_id" IN ('didww', 'esim_access');
DELETE FROM "integration_offers" WHERE "integration_id" IN ('didww', 'esim_access');
DELETE FROM "integration_settings" WHERE "key" ~ '^(DIDWW|ESIM_ACCESS|ESIMERGE|AIRALO|ESIM_GO|TELNYX|VONAGE|TWILIO|PLIVO)_';

-- Home pages: sections, links, products and illustrations of eSIMs and numbers taken out; everything else kept.
CREATE FUNCTION "_rm_scrub"(j JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF j IS NULL THEN
    RETURN NULL;
  ELSIF jsonb_typeof(j) = 'array' THEN
    RETURN COALESCE((
      SELECT jsonb_agg("_rm_scrub"(e) ORDER BY i)
      FROM jsonb_array_elements(j) WITH ORDINALITY AS t(e, i)
      WHERE NOT COALESCE(jsonb_typeof(e) = 'string' AND (e #>> '{}' IN ('esim', 'virtual_numbers') OR e #>> '{}' LIKE 'esim:%' OR e #>> '{}' LIKE 'virtual\_numbers:%'), false)
        AND NOT COALESCE(jsonb_typeof(e) = 'object' AND (e ->> 'illustration' = 'esim' OR e -> 'cta' ->> 'href' ~ '^/catalogs/(esim|esims|virtual_numbers)(\?|/|$)'), false)
    ), '[]'::jsonb);
  ELSIF jsonb_typeof(j) = 'object' THEN
    RETURN COALESCE((
      SELECT jsonb_object_agg(k, CASE WHEN k = 'source' AND v #>> '{}' = 'category' AND j ->> 'category' IN ('esim', 'virtual_numbers') THEN '"new"'::jsonb ELSE "_rm_scrub"(v) END)
      FROM jsonb_each(j) AS t(k, v)
      WHERE NOT COALESCE(k = 'category' AND v #>> '{}' IN ('esim', 'virtual_numbers'), false)
    ), '{}'::jsonb);
  END IF;
  RETURN j;
END $$;

UPDATE "storefront_pages" SET "draft" = "_rm_scrub"("draft"::jsonb), "published" = "_rm_scrub"("published"::jsonb);
UPDATE "storefront_page_versions" SET "sections" = "_rm_scrub"("sections"::jsonb);
UPDATE "stores" SET "home_draft" = "_rm_scrub"("home_draft"::jsonb), "home_published" = "_rm_scrub"("home_published"::jsonb) WHERE "home_draft" IS NOT NULL OR "home_published" IS NOT NULL;
UPDATE "store_home_versions" SET "sections" = "_rm_scrub"("sections"::jsonb);
DROP FUNCTION "_rm_scrub"(JSONB);

-- Product features and supplier feature rules existed only for DIDWW's numbers.
ALTER TABLE "products" DROP COLUMN "features";
ALTER TABLE "suppliers" DROP COLUMN "feature_rules";

-- Crypto left BitoCard for Afrippa (docs/CRYPTO_SPINOFF_PLAN.md): its switches set for BitoCard's resellers are dead
-- settings. Afrippa reads them for all of Afrippa, a country and its own operator account only, which stay.
DELETE FROM "feature_switches"
WHERE "key" IN ('crypto_wallets', 'p2p_trading', 'crypto_app', 'crypto_global', 'crypto_cross_border', 'crypto_install_prompt')
  AND "reseller_id" IS NOT NULL AND "reseller_id" <> '00000000-0000-4000-8000-0000000000a1';

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. The two categories leave the enum (in its database order, less them).
-- ---------------------------------------------------------------------------------------------------------------------

ALTER TYPE "ProductCategory" RENAME TO "ProductCategory_old";
CREATE TYPE "ProductCategory" AS ENUM ('gift_cards', 'airtime', 'data', 'bills', 'pay_tv', 'software', 'virtual_cards', 'mobile_money', 'vpn', 'rdp');
ALTER TABLE "country_categories" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "suppliers" ALTER COLUMN "categories" TYPE "ProductCategory"[] USING "categories"::text[]::"ProductCategory"[];
ALTER TABLE "supplier_markets" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "products" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "pricing_rules" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "reseller_markups" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "fee_rules" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "fee_charges" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "category_presentations" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
DROP TYPE "ProductCategory_old";

DROP TABLE "_rm_deltas";
DROP TABLE "_rm_entries";
DROP TABLE "_rm_refs";
DROP TABLE "_rm_lots";
DROP TABLE "_rm_holds";
DROP TABLE "_rm_disputes";
DROP TABLE "_rm_chargebacks";
DROP TABLE "_rm_fees";
DROP TABLE "_rm_payments";
DROP TABLE "_rm_checkouts";
DROP TABLE "_rm_orders";
DROP TABLE "_rm_quotes";
DROP TABLE "_rm_products";
DROP TABLE "_rm_suppliers";
