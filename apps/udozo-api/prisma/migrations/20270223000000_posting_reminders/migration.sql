-- Reminders to finish posting (6 November 2026, the owner's request), behind the `classifieds_post_reminders` switch:
-- a draft with its title, category and a photo but not yet complete is reminded once, `unfinished_reminder_hours`
-- after it was last changed; a complete draft not yet posted is reminded up to three times, the first
-- `ready_reminder_1_hours` after it was last changed, each next one the market's hours after the reminder before.
-- Each reminder is claimed on the listing once, so a job run twice sends nothing twice.

ALTER TABLE "classified_market_settings"
  ADD COLUMN "unfinished_reminder_hours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN "ready_reminder_1_hours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN "ready_reminder_2_hours" INTEGER NOT NULL DEFAULT 72,
  ADD COLUMN "ready_reminder_3_hours" INTEGER NOT NULL DEFAULT 168;

ALTER TABLE "classified_listings"
  ADD COLUMN "unfinished_reminded_at" TIMESTAMP(3),
  ADD COLUMN "ready_reminders" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ready_reminded_at" TIMESTAMP(3);

-- The job reads drafts by when they were last changed.
CREATE INDEX "classified_listings_status_updated_at_idx" ON "classified_listings"("status", "updated_at");
