-- Step 3 item 8 of docs/CRYPTO_SPINOFF_PLAN.md, finished: nothing is live with real customers yet, so what the retired
-- fiat paths left behind is dropped rather than kept for history. The instant exchange (markups, quotes, trades,
-- reseller desks and their trades, reserve movements), instant P2P trades and the old instant ads go; every ad left is
-- an escrow ad. Resellers' own coins go: on-chain addresses, deposits, saved addresses and withdrawals are customers'
-- (Afrippa's traders') only. Ledger accounts and entries are never deleted, so the account kinds stay.

DROP TABLE "p2p_trades" CASCADE;
DROP TABLE "exchange_trades" CASCADE;
DROP TABLE "exchange_quotes" CASCADE;
DROP TABLE "exchange_markups" CASCADE;
DROP TABLE "reseller_desk_trades" CASCADE;
DROP TABLE "reseller_desk_quotes" CASCADE;
DROP TABLE "exchange_desks" CASCADE;
DROP TABLE "reserve_movements" CASCADE;

-- The old instant ads, then the columns only they used.
DELETE FROM "p2p_ad_payment_methods" WHERE "ad_id" IN (SELECT "id" FROM "p2p_ads" WHERE NOT "escrow");
DELETE FROM "p2p_ads" WHERE NOT "escrow";
ALTER TABLE "p2p_ads" DROP CONSTRAINT "p2p_ads_payment_window";
ALTER TABLE "p2p_ads" DROP CONSTRAINT "p2p_ads_escrow_locks_no_fiat";
ALTER TABLE "p2p_ads" DROP COLUMN "escrow", DROP COLUMN "fiat_locked_minor", DROP COLUMN "fiat_from_proceeds";
ALTER TABLE "p2p_ads" ADD CONSTRAINT "p2p_ads_payment_window" CHECK ("payment_window_minutes" IN (15, 30, 60));

-- Resellers' own coins.
DELETE FROM "crypto_withdrawals" WHERE "reseller_id" IS NOT NULL;
DELETE FROM "crypto_withdrawal_addresses" WHERE "reseller_id" IS NOT NULL;
DELETE FROM "crypto_deposits" WHERE "reseller_id" IS NOT NULL;
DELETE FROM "crypto_addresses" WHERE "reseller_id" IS NOT NULL;
ALTER TABLE "crypto_withdrawals" DROP COLUMN "reseller_id", DROP COLUMN "requested_by", ALTER COLUMN "customer_id" SET NOT NULL;
ALTER TABLE "crypto_withdrawal_addresses" DROP COLUMN "reseller_id", ALTER COLUMN "customer_id" SET NOT NULL;
ALTER TABLE "crypto_deposits" DROP COLUMN "reseller_id", ALTER COLUMN "customer_id" SET NOT NULL;
ALTER TABLE "crypto_addresses" DROP COLUMN "reseller_id", ALTER COLUMN "customer_id" SET NOT NULL;

DELETE FROM "notifications" WHERE "type" IN ('crypto.deposit_credited', 'crypto.withdrawal_sent', 'crypto.withdrawal_failed', 'crypto.address_added');
DELETE FROM "notification_preferences" WHERE "type" IN ('crypto.deposit_credited', 'crypto.withdrawal_sent', 'crypto.withdrawal_failed', 'crypto.address_added');
