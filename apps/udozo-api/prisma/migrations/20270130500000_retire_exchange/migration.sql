-- The instant exchange and resellers' own coins are retired (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 8): their
-- switches, plan features, notification types and settings go. The exchange's tables (quotes, trades, desks, markups,
-- reserve movements) and its ledger accounts stay until the live database is confirmed to hold nothing in them.

DELETE FROM "feature_switches" WHERE "key" IN ('crypto_exchange', 'reseller_exchange', 'reseller_desks');

UPDATE "plans"
SET "features" = array_remove(array_remove("features", 'onchain_crypto'), 'reseller_desks')
WHERE "features" && ARRAY['onchain_crypto', 'reseller_desks'];

DELETE FROM "notifications" WHERE "type" IN ('exchange.reserve_low', 'admin.exchange.reserve_low', 'admin.exchange.price_divergence', 'customer.exchange.completed');
DELETE FROM "notification_preferences" WHERE "type" IN ('exchange.reserve_low', 'admin.exchange.reserve_low', 'admin.exchange.price_divergence', 'customer.exchange.completed');

ALTER TABLE "countries" DROP COLUMN "exchange_markup_cap_bps", DROP COLUMN "exchange_reserve_alert_minor";
ALTER TABLE "crypto_assets" DROP COLUMN "exchange_daily_limit", DROP COLUMN "exchange_reserve_alert";
