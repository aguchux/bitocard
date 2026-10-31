-- Afrippa's escrow engine, step 3 item 7 (docs/CRYPTO_SPINOFF_PLAN.md): fraud controls. The buyer names the account they
-- paid from (their own, in their verified name), shown to the seller; and markets set tighter limits for new traders
-- (fewer than five completed orders), per order and per 24 hours.
ALTER TABLE "p2p_orders" ADD COLUMN "paid_from_method_id" UUID;
ALTER TABLE "p2p_orders" ADD CONSTRAINT "p2p_orders_paid_from_method_id_fkey" FOREIGN KEY ("paid_from_method_id") REFERENCES "p2p_payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crypto_market_limits" ADD COLUMN "new_trader_per_trade_minor" BIGINT;
ALTER TABLE "crypto_market_limits" ADD COLUMN "new_trader_per_day_minor" BIGINT;
