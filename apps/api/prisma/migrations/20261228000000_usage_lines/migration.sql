-- Usage billed as it happens: AI replies beyond the allowance (per store, if chosen) and mobile money deposit fees.
ALTER TABLE "plans" ADD COLUMN "usage_margin_bps" INTEGER NOT NULL DEFAULT 2000;
ALTER TABLE "plans" ADD CONSTRAINT "plans_usage_margin_check" CHECK ("usage_margin_bps" >= 0 AND "usage_margin_bps" <= 20000);
ALTER TABLE "stores" ADD COLUMN "ai_overage" TEXT NOT NULL DEFAULT 'stop';
ALTER TABLE "stores" ADD CONSTRAINT "stores_ai_overage_check" CHECK ("ai_overage" IN ('stop', 'pay'));
