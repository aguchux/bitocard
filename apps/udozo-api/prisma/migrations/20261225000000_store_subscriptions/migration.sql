-- Plans become per store. A store without a row here is on the free plan (Startup).
CREATE TABLE "store_subscriptions" (
    "store_id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "plan_code" TEXT NOT NULL,
    "renews_at" TIMESTAMP(3),
    "period_started_at" TIMESTAMP(3),
    "paid_minor" BIGINT NOT NULL DEFAULT 0,
    "paid_currency" CHAR(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "next_plan_code" TEXT,
    "past_due_since" TIMESTAMP(3),
    "migrated" BOOLEAN NOT NULL DEFAULT false,
    "transition_notice_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "store_subscriptions_pkey" PRIMARY KEY ("store_id"),
    CONSTRAINT "store_subscriptions_paid_check" CHECK ("paid_minor" >= 0)
);
CREATE INDEX "store_subscriptions_reseller_id_idx" ON "store_subscriptions"("reseller_id");
CREATE INDEX "store_subscriptions_renews_at_idx" ON "store_subscriptions"("renews_at");
ALTER TABLE "store_subscriptions" ADD CONSTRAINT "store_subscriptions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_subscriptions" ADD CONSTRAINT "store_subscriptions_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "plans"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BitoCard's own stores are Enterprise and never billed.
UPDATE "resellers" SET "plan_code" = 'enterprise' WHERE "house" = true AND EXISTS (SELECT 1 FROM "plans" WHERE "code" = 'enterprise');
INSERT INTO "store_subscriptions" ("store_id", "reseller_id", "plan_code", "updated_at")
SELECT s."id", s."reseller_id", r."plan_code", CURRENT_TIMESTAMP
FROM "stores" s JOIN "resellers" r ON r."id" = s."reseller_id"
WHERE r."house" = true AND r."plan_code" <> 'standard';

-- Resellers on a paid plan: every store keeps it, free, until the account's renewal date (at least 14 days from now, so
-- each reseller is told first). Only the oldest published store (else the oldest) renews then; the others end at that
-- date unless the reseller keeps them. A plan an admin set (not billed) stays on every store, unbilled.
WITH paid AS (
  SELECT r."id", r."plan_code", r."plan_renews_at", r."plan_cancel_at_period_end"
  FROM "resellers" r WHERE r."house" = false AND r."plan_code" <> 'standard'
), first_store AS (
  SELECT DISTINCT ON (s."reseller_id") s."reseller_id", s."id"
  FROM "stores" s JOIN paid p ON p."id" = s."reseller_id"
  ORDER BY s."reseller_id", (s."status" = 'published') DESC, s."created_at" ASC
)
INSERT INTO "store_subscriptions" ("store_id", "reseller_id", "plan_code", "renews_at", "period_started_at", "cancel_at_period_end", "migrated", "updated_at")
SELECT s."id", p."id", p."plan_code",
  CASE WHEN p."plan_renews_at" IS NULL THEN NULL ELSE GREATEST(p."plan_renews_at", CURRENT_TIMESTAMP + INTERVAL '14 days') END,
  CASE WHEN p."plan_renews_at" IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
  CASE WHEN p."plan_renews_at" IS NULL THEN false ELSE (p."plan_cancel_at_period_end" OR s."id" <> f."id") END,
  p."plan_renews_at" IS NOT NULL,
  CURRENT_TIMESTAMP
FROM "stores" s JOIN paid p ON p."id" = s."reseller_id" JOIN first_store f ON f."reseller_id" = p."id";

-- Their account billing now lives on the stores (resellers on a paid plan with no store keep it as it was).
UPDATE "resellers" r SET "plan_renews_at" = NULL, "plan_cancel_at_period_end" = false, "plan_past_due_since" = NULL
WHERE EXISTS (SELECT 1 FROM "store_subscriptions" ss WHERE ss."reseller_id" = r."id");
