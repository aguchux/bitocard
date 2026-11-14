-- eSIMs and virtual phone numbers are gone for good (the owner's decision, 14 November 2026): their categories, their
-- suppliers (DIDWW, eSIM Access, and the registry's eSimerge, Airalo Partners, eSIM Go, Telnyx, Vonage, Twilio and
-- Plivo), every order of them with everything hanging off it, the eSIMs, numbers and SMS kept after their orders, and
-- the ledger entries all of that posted. Entries are taken out of the books exactly: each account's balance first loses
-- what the entry's postings added to it (by the account's normal side, as LedgerService posts), then the postings and
-- entries go, so every balance still equals the sum of its remaining postings and the books stay balanced.

-- ---------------------------------------------------------------------------
-- What goes
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE "rm_suppliers" ("code" TEXT PRIMARY KEY);
INSERT INTO "rm_suppliers" VALUES ('didww'), ('esim_access'), ('esimerge'), ('airalo'), ('esim_go'), ('telnyx'), ('vonage'), ('twilio'), ('plivo');

CREATE TEMP TABLE "rm_products" AS SELECT "id", "key" FROM "products" WHERE "category"::text IN ('esim', 'virtual_numbers');

CREATE TEMP TABLE "rm_quotes" AS
  SELECT "id" FROM "quotes" WHERE "product_id" IN (SELECT "id" FROM "rm_products") OR "supplier_code" IN (SELECT "code" FROM "rm_suppliers");

CREATE TEMP TABLE "rm_orders" AS
  SELECT "id", "hold_id", "fee_charge_id" FROM "orders"
  WHERE "product_id" IN (SELECT "id" FROM "rm_products")
     OR "supplier_code" IN (SELECT "code" FROM "rm_suppliers")
     OR "quote_id" IN (SELECT "id" FROM "rm_quotes");

CREATE TEMP TABLE "rm_checkouts" AS
  SELECT "id", "payment_id", "fee_charge_id" FROM "checkouts"
  WHERE "order_id" IN (SELECT "id" FROM "rm_orders") OR "quote_id" IN (SELECT "id" FROM "rm_quotes");

CREATE TEMP TABLE "rm_payments" AS SELECT "payment_id" AS "id" FROM "rm_checkouts" WHERE "payment_id" IS NOT NULL;

CREATE TEMP TABLE "rm_chargebacks" AS SELECT "id", "hold_id" FROM "chargebacks" WHERE "payment_id" IN (SELECT "id" FROM "rm_payments");

CREATE TEMP TABLE "rm_disputes" AS
  SELECT "id" FROM "disputes"
  WHERE "order_id" IN (SELECT "id" FROM "rm_orders")
     OR "checkout_id" IN (SELECT "id" FROM "rm_checkouts")
     OR "payment_id" IN (SELECT "id" FROM "rm_payments")
     OR "chargeback_id" IN (SELECT "id" FROM "rm_chargebacks");

CREATE TEMP TABLE "rm_fee_charges" AS
  SELECT "id", "reference", "hold_id", "reseller_id", "mode", "currency", "exact_nano", "extra_nano", "charged_minor", "status"::text AS "status"
  FROM "fee_charges"
  WHERE ("source_type" = 'order' AND "source_id" IN (SELECT "id"::text FROM "rm_orders"))
     OR ("source_type" = 'payment' AND "source_id" IN (SELECT "id"::text FROM "rm_payments"))
     OR "id" IN (SELECT "fee_charge_id" FROM "rm_orders" WHERE "fee_charge_id" IS NOT NULL)
     OR "id" IN (SELECT "fee_charge_id" FROM "rm_checkouts" WHERE "fee_charge_id" IS NOT NULL);

CREATE TEMP TABLE "rm_funding" AS SELECT "id" FROM "supplier_funding_movements" WHERE "supplier_code" IN (SELECT "code" FROM "rm_suppliers");

-- Holds: the orders', their fees', their payments' chargebacks', and every eSIM top-up, number renewal and SMS.
CREATE TEMP TABLE "rm_holds" AS
  SELECT "id", "reference" FROM "holds"
  WHERE "id" IN (SELECT "hold_id" FROM "rm_orders" WHERE "hold_id" IS NOT NULL)
     OR "id" IN (SELECT "hold_id" FROM "rm_fee_charges" WHERE "hold_id" IS NOT NULL)
     OR "id" IN (SELECT "hold_id" FROM "rm_chargebacks" WHERE "hold_id" IS NOT NULL)
     OR "id" IN (SELECT "hold_id" FROM "esim_top_ups" WHERE "hold_id" IS NOT NULL)
     OR "id" IN (SELECT "hold_id" FROM "number_messages" WHERE "hold_id" IS NOT NULL)
     OR "reference" IN (SELECT 'order:' || "id" FROM "rm_orders")
     OR "reference" IN (SELECT "reference" || ':hold' FROM "rm_fee_charges")
     OR "reference" IN (SELECT 'chargeback:' || "id" FROM "rm_chargebacks")
     OR "reference" LIKE 'esim\_top\_up:%'
     OR "reference" LIKE 'number\_renewal:%'
     OR "reference" IN (SELECT 'sms:' || "id" FROM "number_messages");

-- Earnings of checkout orders (the store's margin) and of eSIM top-ups sold to customers.
CREATE TEMP TABLE "rm_lots" AS
  SELECT "id", "reference" FROM "earnings_lots"
  WHERE "reference" IN (SELECT 'order:' || "id" FROM "rm_orders") OR "reference" LIKE 'esim\_top\_up\_earnings:%';

CREATE TEMP TABLE "rm_entries" ("id" UUID PRIMARY KEY);
INSERT INTO "rm_entries"
  SELECT "id" FROM "journal_entries" e
  WHERE e."metadata" ->> 'hold_id' IN (SELECT "id"::text FROM "rm_holds")
     OR e."metadata" ->> 'order_id' IN (SELECT "id"::text FROM "rm_orders")
     OR e."metadata" ->> 'esim_top_up_id' IS NOT NULL
     OR e."reference" IN (SELECT p || h."id" FROM "rm_holds" h CROSS JOIN (VALUES ('hold:'), ('hold_capture:'), ('hold_release:')) AS v(p))
     OR e."reference" IN (SELECT 'conversion:hold:' || "reference" FROM "rm_holds")
     OR e."reference" IN (SELECT p || o."id" FROM "rm_orders" o CROSS JOIN (VALUES ('order_cost:'), ('order_refund:'), ('earnings:order:')) AS v(p))
     OR e."reference" IN (SELECT 'earnings:' || "reference" FROM "rm_lots")
     OR e."reference" IN (SELECT 'earnings_release:' || "id" FROM "rm_lots")
     OR e."reference" IN (SELECT "reference" FROM "rm_fee_charges")
     OR e."reference" IN (SELECT 'fee:refund:' || "id" FROM "rm_fee_charges")
     OR e."reference" IN (SELECT 'payment:' || "id" FROM "rm_payments")
     OR e."reference" IN (SELECT p || c."id" FROM "rm_checkouts" c CROSS JOIN (VALUES ('wallet_purchase:'), ('checkout_refund:')) AS v(p))
     OR e."reference" IN (SELECT 'chargeback:lost:' || "id" FROM "rm_chargebacks")
     OR e."reference" IN (SELECT 'dispute:' || "id" || ':credit' FROM "rm_disputes")
     OR e."reference" IN (SELECT 'supplier_funding:' || "id" FROM "rm_funding")
     OR e."reference" LIKE 'esim\_top\_up\_%:%'
     OR e."reference" LIKE 'number\_renewal\_cost:%'
     OR e."reference" LIKE 'sms\_cost:%'
  ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- The books: balances lose what the entries added, then the entries go
-- ---------------------------------------------------------------------------

-- What each account loses: a debit-normal account (as LedgerService's `debitNormal`) moved by +amount, every other
-- account by -amount, so taking the entry back moves it the other way.
CREATE TEMP TABLE "rm_deltas" AS
  SELECT p."account_id",
         SUM(CASE WHEN a."kind"::text IN ('reseller_owed', 'provider_balance', 'processing_fees', 'supplier_float', 'cost_of_sales', 'promotions', 'crypto_custody', 'crypto_promotions')
                  THEN p."amount_minor" ELSE -p."amount_minor" END) AS "delta"
  FROM "ledger_postings" p JOIN "ledger_accounts" a ON a."id" = p."account_id"
  WHERE p."entry_id" IN (SELECT "id" FROM "rm_entries")
  GROUP BY p."account_id";

-- Money already moved on (an earnings credit since paid out, for example) cannot be taken back without a negative
-- balance: stop with what to look at instead of leaving the books wrong.
DO $$
DECLARE
  short TEXT;
BEGIN
  SELECT string_agg(a."kind"::text || ' ' || a."owner_key" || ' ' || a."currency" || ' (' || a."mode"::text || ')', ', ')
    INTO short
  FROM "ledger_accounts" a JOIN "rm_deltas" d ON d."account_id" = a."id"
  WHERE a."non_negative" AND a."balance_minor" - d."delta" < 0;
  IF short IS NOT NULL THEN
    RAISE EXCEPTION 'Removing eSIM and number entries would leave these accounts below zero: %. Adjust them by hand first.', short;
  END IF;
END $$;

UPDATE "ledger_accounts" a SET "balance_minor" = a."balance_minor" - d."delta" FROM "rm_deltas" d WHERE a."id" = d."account_id";
DELETE FROM "ledger_postings" WHERE "entry_id" IN (SELECT "id" FROM "rm_entries");
DELETE FROM "journal_entries" WHERE "id" IN (SELECT "id" FROM "rm_entries");

-- Live fees are invoice lines: the invoice loses them.
UPDATE "invoices" i SET "total_minor" = i."total_minor" - l."amount", "paid_minor" = i."paid_minor" - l."paid"
FROM (
  SELECT "invoice_id", SUM("amount_minor") AS "amount", SUM("paid_minor") AS "paid" FROM "invoice_lines"
  WHERE "reference" IN (SELECT "reference" FROM "rm_fee_charges") GROUP BY "invoice_id"
) l
WHERE i."id" = l."invoice_id";
DELETE FROM "invoice_lines" WHERE "reference" IN (SELECT "reference" FROM "rm_fee_charges");

-- A charged fee moved the reseller's fee carry by (exact + extra) - charged x 10^9: give that back where the carry
-- stays a fraction of one unit, so charges and carry still reconcile.
UPDATE "fee_carries" c SET "carry_nano" = c."carry_nano" - f."moved", "updated_at" = now()
FROM (
  SELECT "reseller_id", "mode", "currency", SUM("exact_nano" + COALESCE("extra_nano", 0) - COALESCE("charged_minor", 0) * 1000000000) AS "moved"
  FROM "rm_fee_charges" WHERE "status" IN ('charged', 'refunded') GROUP BY "reseller_id", "mode", "currency"
) f
WHERE c."reseller_id" = f."reseller_id" AND c."mode" = f."mode" AND c."currency" = f."currency"
  AND c."carry_nano" - f."moved" >= 0 AND c."carry_nano" - f."moved" < 1000000000;

-- ---------------------------------------------------------------------------
-- The records
-- ---------------------------------------------------------------------------

-- Webhook events (their deliveries go with them) and notices about them.
DELETE FROM "events"
WHERE "type" IN ('number.renewed', 'number.expired', 'number.deleted', 'number.sms_received', 'esim.updated')
   OR ("payload"::jsonb -> 'data' -> 'object' ->> 'id') IN (SELECT "id"::text FROM "rm_orders" UNION ALL SELECT "id"::text FROM "rm_disputes");
UPDATE "webhook_endpoints"
SET "events" = array_remove(array_remove(array_remove(array_remove(array_remove("events", 'number.renewed'), 'number.expired'), 'number.deleted'), 'number.sms_received'), 'esim.updated')
WHERE "events" && ARRAY['number.renewed', 'number.expired', 'number.deleted', 'number.sms_received', 'esim.updated'];

DELETE FROM "notifications"
WHERE "type" IN ('number.expiring', 'number.renewal_failed', 'number.expired', 'number.deleted', 'admin.esim.top_up_unclear', 'customer.esim.low_data', 'customer.esim.expiring');
DELETE FROM "notification_preferences"
WHERE "type" IN ('number.expiring', 'number.renewal_failed', 'number.expired', 'number.deleted', 'admin.esim.top_up_unclear', 'customer.esim.low_data', 'customer.esim.expiring');

DELETE FROM "supplier_webhooks" WHERE "supplier_code" IN (SELECT "code" FROM "rm_suppliers") OR "order_id" IN (SELECT "id" FROM "rm_orders");

-- Questions about the orders stay with their stores; they just no longer point at an order.
UPDATE "support_tickets" SET "order_id" = NULL WHERE "order_id" IN (SELECT "id" FROM "rm_orders");
UPDATE "support_tickets" SET "checkout_id" = NULL WHERE "checkout_id" IN (SELECT "id" FROM "rm_checkouts");

DELETE FROM "disputes" WHERE "id" IN (SELECT "id" FROM "rm_disputes");
DELETE FROM "chargebacks" WHERE "id" IN (SELECT "id" FROM "rm_chargebacks");
DELETE FROM "holds" WHERE "id" IN (SELECT "id" FROM "rm_holds");
DELETE FROM "earnings_lots" WHERE "id" IN (SELECT "id" FROM "rm_lots");
DELETE FROM "fee_charges" WHERE "id" IN (SELECT "id" FROM "rm_fee_charges");
DELETE FROM "checkouts" WHERE "id" IN (SELECT "id" FROM "rm_checkouts");
DELETE FROM "payments" WHERE "id" IN (SELECT "id" FROM "rm_payments");

DROP TABLE "esim_top_ups";
DROP TABLE "esims";
DROP TABLE "number_messages";
DROP TABLE "virtual_numbers";

-- Deliveries, order pages and their codes, and supplier attempts go with their orders.
DELETE FROM "orders" WHERE "id" IN (SELECT "id" FROM "rm_orders");
DELETE FROM "quotes" WHERE "id" IN (SELECT "id" FROM "rm_quotes");

-- ---------------------------------------------------------------------------
-- The catalogue, suppliers and their settings
-- ---------------------------------------------------------------------------

DELETE FROM "pricing_rules" WHERE "category"::text IN ('esim', 'virtual_numbers') OR "product_id" IN (SELECT "id" FROM "rm_products") OR "supplier_code" IN (SELECT "code" FROM "rm_suppliers");
DELETE FROM "reseller_markups" WHERE "category"::text IN ('esim', 'virtual_numbers') OR "product_id" IN (SELECT "id" FROM "rm_products");
DELETE FROM "fee_rules" WHERE "category"::text IN ('esim', 'virtual_numbers');
UPDATE "fee_charges" SET "category" = NULL WHERE "category"::text IN ('esim', 'virtual_numbers');
-- Offers, listings and resellers' own offers go with their products.
DELETE FROM "supplier_products" WHERE "supplier_code" IN (SELECT "code" FROM "rm_suppliers");
DELETE FROM "products" WHERE "id" IN (SELECT "id" FROM "rm_products");
DELETE FROM "country_categories" WHERE "category"::text IN ('esim', 'virtual_numbers');
DELETE FROM "category_presentations" WHERE "category"::text IN ('esim', 'virtual_numbers');
DELETE FROM "supplier_markets" WHERE "category"::text IN ('esim', 'virtual_numbers');
DELETE FROM "supplier_funding_movements" WHERE "id" IN (SELECT "id" FROM "rm_funding");
DELETE FROM "suppliers" WHERE "code" IN (SELECT "code" FROM "rm_suppliers");
UPDATE "suppliers" SET "categories" = array_remove(array_remove("categories", 'esim'), 'virtual_numbers') WHERE "categories" && ARRAY['esim', 'virtual_numbers']::"ProductCategory"[];

-- The suppliers' ledger accounts, once nothing is posted to them.
DELETE FROM "ledger_accounts" a
WHERE a."owner_key" IN (SELECT 'provider:' || "code" FROM "rm_suppliers")
  AND NOT EXISTS (SELECT 1 FROM "ledger_postings" p WHERE p."account_id" = a."id");

DELETE FROM "integration_settings"
WHERE "key" LIKE 'DIDWW\_%' OR "key" LIKE 'ESIM\_ACCESS\_%' OR "key" LIKE 'ESIMERGE\_%' OR "key" LIKE 'AIRALO\_%' OR "key" LIKE 'ESIM\_GO\_%'
   OR "key" LIKE 'TELNYX\_%' OR "key" LIKE 'VONAGE\_%' OR "key" LIKE 'TWILIO\_%' OR "key" LIKE 'PLIVO\_%';
DELETE FROM "integration_offers" WHERE "integration_id" IN (SELECT "code" FROM "rm_suppliers");
-- Resellers' own DIDWW and eSIM Access accounts (and their offers).
DELETE FROM "reseller_connections" WHERE "integration_id" IN (SELECT "code" FROM "rm_suppliers");

DELETE FROM "brand_assets" WHERE "slug" = 'airalo';
DELETE FROM "brands" WHERE "slug" = 'airalo';

-- ---------------------------------------------------------------------------
-- Home pages: nothing left pointing at eSIMs or numbers
-- ---------------------------------------------------------------------------

-- The eSIM illustration becomes the globe; links to their catalogues go to the whole catalogue; a rail of either
-- category shows software instead; their categories and product keys leave every list.
CREATE FUNCTION pg_temp.rm_clean(value JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  result JSONB;
  item RECORD;
BEGIN
  IF jsonb_typeof(value) = 'object' THEN
    result := '{}'::jsonb;
    FOR item IN SELECT * FROM jsonb_each(value) LOOP
      IF item.key = 'illustration' AND item.value = '"esim"'::jsonb THEN
        result := result || jsonb_build_object(item.key, 'globe');
      ELSIF item.key = 'category' AND item.value IN ('"esim"'::jsonb, '"virtual_numbers"'::jsonb) THEN
        result := result || jsonb_build_object(item.key, 'software');
      ELSIF jsonb_typeof(item.value) = 'string' AND (item.value #>> '{}') ~ '^/catalogs/(esim|esims|virtual_numbers)([/?#]|$)' THEN
        result := result || jsonb_build_object(item.key, '/catalogs');
      ELSE
        result := result || jsonb_build_object(item.key, pg_temp.rm_clean(item.value));
      END IF;
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(value) = 'array' THEN
    SELECT COALESCE(jsonb_agg(pg_temp.rm_clean(element) ORDER BY position), '[]'::jsonb) INTO result
    FROM jsonb_array_elements(value) WITH ORDINALITY AS t(element, position)
    WHERE NOT (jsonb_typeof(element) = 'string' AND ((element #>> '{}') IN ('esim', 'virtual_numbers', 'esims') OR (element #>> '{}') ~ '^(esim|virtual_numbers):'));
    RETURN result;
  END IF;
  RETURN value;
END $$;

UPDATE "storefront_pages" SET "draft" = pg_temp.rm_clean("draft"), "published" = pg_temp.rm_clean("published");
UPDATE "storefront_page_versions" SET "sections" = pg_temp.rm_clean("sections");
UPDATE "stores" SET "home_draft" = pg_temp.rm_clean("home_draft"), "home_published" = pg_temp.rm_clean("home_published") WHERE "home_draft" IS NOT NULL OR "home_published" IS NOT NULL;
UPDATE "store_home_versions" SET "sections" = pg_temp.rm_clean("sections");
UPDATE "stores" SET "focus" = NULL WHERE "focus" ~ '^(esim|virtual_numbers):';

DROP FUNCTION pg_temp.rm_clean(JSONB);

-- ---------------------------------------------------------------------------
-- The schema
-- ---------------------------------------------------------------------------

ALTER TABLE "products" DROP COLUMN "features";
ALTER TABLE "suppliers" DROP COLUMN "feature_rules";

ALTER TYPE "ProductCategory" RENAME TO "ProductCategory_old";
CREATE TYPE "ProductCategory" AS ENUM ('gift_cards', 'airtime', 'data', 'bills', 'pay_tv', 'software', 'vpn', 'rdp', 'virtual_cards', 'mobile_money');
ALTER TABLE "country_categories" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "suppliers" ALTER COLUMN "categories" TYPE "ProductCategory"[] USING "categories"::text[]::"ProductCategory"[];
ALTER TABLE "supplier_markets" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "products" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "pricing_rules" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "reseller_markups" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "category_presentations" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "fee_rules" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
ALTER TABLE "fee_charges" ALTER COLUMN "category" TYPE "ProductCategory" USING "category"::text::"ProductCategory";
DROP TYPE "ProductCategory_old";

DROP TABLE "rm_entries", "rm_deltas", "rm_lots", "rm_holds", "rm_funding", "rm_fee_charges", "rm_disputes", "rm_chargebacks", "rm_payments", "rm_checkouts", "rm_orders", "rm_quotes", "rm_products", "rm_suppliers";
