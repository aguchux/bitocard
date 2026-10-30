-- SHQ's guide to creating a first store: how many times each team member was shown it, and when last.
ALTER TABLE "reseller_members" ADD COLUMN "store_guide_shown" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "reseller_members" ADD COLUMN "store_guide_shown_at" TIMESTAMP(3);
