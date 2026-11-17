-- The airtime exchange on resellers' stores: each network caps the reseller's cut, and a trade keeps its reseller,
-- their cut (basis points of BitoCard's rate) and what it came to.
ALTER TABLE "airtime_networks" ADD COLUMN "reseller_cap_bps" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "airtime_networks" ADD CONSTRAINT "airtime_networks_reseller_cap_bps_check" CHECK ("reseller_cap_bps" BETWEEN 0 AND 5000);

ALTER TABLE "airtime_sales" ADD COLUMN "reseller_id" UUID;
ALTER TABLE "airtime_sales" ADD COLUMN "reseller_spread_bps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "airtime_sales" ADD COLUMN "reseller_earning_minor" BIGINT;
ALTER TABLE "airtime_sales" ADD CONSTRAINT "airtime_sales_reseller_spread_bps_check" CHECK ("reseller_spread_bps" BETWEEN 0 AND 5000);
CREATE INDEX "airtime_sales_reseller_id_created_at_idx" ON "airtime_sales" ("reseller_id", "created_at");

ALTER TABLE "airtime_purchases" ADD COLUMN "reseller_id" UUID;
ALTER TABLE "airtime_purchases" ADD COLUMN "reseller_spread_bps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "airtime_purchases" ADD COLUMN "reseller_earning_minor" BIGINT;
ALTER TABLE "airtime_purchases" ADD CONSTRAINT "airtime_purchases_reseller_spread_bps_check" CHECK ("reseller_spread_bps" BETWEEN 0 AND 5000);
CREATE INDEX "airtime_purchases_reseller_id_created_at_idx" ON "airtime_purchases" ("reseller_id", "created_at");
