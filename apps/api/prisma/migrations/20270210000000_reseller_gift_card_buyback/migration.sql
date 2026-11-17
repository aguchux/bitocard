-- Buy back on resellers' stores: a sale keeps its reseller and their cut of BitoCard's payout.
ALTER TABLE "gift_card_sales" ADD COLUMN "reseller_id" UUID;
ALTER TABLE "gift_card_sales" ADD COLUMN "reseller_spread_bps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "gift_card_sales" ADD COLUMN "reseller_earning_minor" BIGINT;
ALTER TABLE "gift_card_sales" ADD CONSTRAINT "gift_card_sales_reseller_spread_bps_check" CHECK ("reseller_spread_bps" BETWEEN 0 AND 5000);
CREATE INDEX "gift_card_sales_reseller_id_created_at_idx" ON "gift_card_sales" ("reseller_id", "created_at");
