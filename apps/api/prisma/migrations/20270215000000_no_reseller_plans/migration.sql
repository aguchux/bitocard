-- BitoCard has no reseller plans any more (22 November 2026, the owner's decision): every reseller may use every
-- feature, within the market's switches and the admins' ceilings. Nobody was on a paid plan, so nothing is refunded.
-- This migration only moves data; the plan tables and columns are dropped in a later release, so an API still running
-- the previous release during a deploy never meets a missing column.

-- Every reseller back on the base (free) plan, and every store subscription ended.
UPDATE "resellers" SET "plan_code" = 'standard', "plan_renews_at" = NULL, "plan_cancel_at_period_end" = false, "plan_past_due_since" = NULL;
DELETE FROM "store_subscriptions";

-- How many stores a reseller may run: null follows the admin's setting for everyone (one by default).
ALTER TABLE "resellers" ADD COLUMN "max_stores" INTEGER;

-- Beyond each store's monthly allowance, BitoCard's AI keeps answering and is charged to the reseller's wallet.
ALTER TABLE "stores" ALTER COLUMN "ai_overage" SET DEFAULT 'pay';
-- Your brand only is each store's own choice now (it was a plan feature): every store keeps what its plan gave it.
ALTER TABLE "stores" ADD COLUMN "white_label" BOOLEAN NOT NULL DEFAULT false;
UPDATE "stores" AS s SET "white_label" = true
FROM "resellers" AS r, "plans" AS p
WHERE s."reseller_id" = r."id" AND p."code" = r."plan_code" AND 'white_label' = ANY (p."features") AND NOT r."house";
UPDATE "stores" SET "ai_overage" = 'pay';

-- Fee rules lose their plan: a rule for every plan wins over a plan's own; otherwise one plan's rule is kept (the free
-- plan's, else the lowest rate) for everyone.
DELETE FROM "fee_rules" AS planned
WHERE planned."plan_code" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "fee_rules" AS everyone
    WHERE everyone."plan_code" IS NULL
      AND everyone."kind" = planned."kind"
      AND everyone."country_code" IS NOT DISTINCT FROM planned."country_code"
      AND everyone."category" IS NOT DISTINCT FROM planned."category"
  );
DELETE FROM "fee_rules"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "kind", "country_code", "category"
      ORDER BY ("plan_code" = 'standard') DESC, "rate_ppb" ASC, "id"
    ) AS rank
    FROM "fee_rules"
    WHERE "plan_code" IS NOT NULL
  ) AS ranked
  WHERE ranked.rank > 1
);
UPDATE "fee_rules" SET "plan_code" = NULL;
UPDATE "fee_rules" SET "scope_key" = regexp_replace("scope_key", ':[^:]*$', '');
