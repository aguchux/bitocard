-- Spin and win: how many spins a customer may take per day, set per market by admins (Settings > Markets).
ALTER TABLE "countries" ADD COLUMN "spin_daily_limit" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "countries" ADD CONSTRAINT "countries_spin_daily_limit_check" CHECK ("spin_daily_limit" BETWEEN 1 AND 10);
