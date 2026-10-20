-- Plans admins create and arrange: whether resellers can choose a plan, and its place in the list.
ALTER TABLE "plans" ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "plans" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
UPDATE "plans" SET "sort_order" = 10 WHERE "code" = 'premium';

-- Five features that were open to every reseller are now plan features. Every existing plan keeps them, so nobody loses
-- anything; admins switch them off per plan from now on.
UPDATE "plans" SET "features" = array_cat("features", ARRAY(
  SELECT feature FROM unnest(ARRAY['multiple_stores', 'custom_domains', 'store_traffic', 'reseller_desks', 'team_members']) AS feature
  WHERE NOT (feature = ANY("plans"."features"))
));
