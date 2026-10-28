-- BitoCard's instant P2P trades and the fiat buy ads locked are retired (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 8):
-- the market is Afrippa's escrow ads and orders. The cross-border payout hold applied only to instant trades' money,
-- and the trade notifications go with them. The trades table, old ads and their locks stay (closing an old ad still
-- gives back what it locks) until the live database is confirmed to hold nothing in them.

-- Only Afrippa's traders use the market, so the reseller switch letting their store's customers trade abroad goes.
DELETE FROM "feature_switches" WHERE "key" = 'crypto_trade_abroad';

ALTER TABLE "crypto_market_limits" DROP COLUMN "cross_border_hold_days";

DELETE FROM "notifications" WHERE "type" = 'customer.p2p.trade_completed';
DELETE FROM "notification_preferences" WHERE "type" = 'customer.p2p.trade_completed';
