-- The most one taker may exchange of a coin in 24 hours (null: no limit), and capped code resends.
ALTER TABLE "crypto_assets" ADD COLUMN "exchange_daily_limit" TEXT;
ALTER TABLE "manual_top_ups" ADD COLUMN "code_sends" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "reserve_movements" ADD COLUMN "code_sends" INTEGER NOT NULL DEFAULT 1;
-- Reseller desks' markup cap per market, and BitoCard's low-reserve alert levels.
ALTER TABLE "countries" ADD COLUMN "exchange_markup_cap_bps" INTEGER NOT NULL DEFAULT 500 CHECK ("exchange_markup_cap_bps" BETWEEN 0 AND 2000);
ALTER TABLE "countries" ADD COLUMN "exchange_reserve_alert_minor" BIGINT CHECK ("exchange_reserve_alert_minor" >= 0);
ALTER TABLE "crypto_assets" ADD COLUMN "exchange_reserve_alert" TEXT;
