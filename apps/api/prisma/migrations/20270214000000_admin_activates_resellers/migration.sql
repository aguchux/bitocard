-- Passing the identity check no longer takes a reseller live: an admin activates every verified reseller, so the
-- switch that chose between the two is gone.
DELETE FROM "feature_switches" WHERE "key" = 'manual_reseller_approval';
