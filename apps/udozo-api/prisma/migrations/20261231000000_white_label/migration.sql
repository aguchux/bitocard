-- Your brand only: paid plans leave BitoCard's name out of their stores' pages.
UPDATE "plans" SET "features" = array_append("features", 'white_label') WHERE "code" IN ('premium', 'enterprise') AND NOT ('white_label' = ANY("features"));
