-- A top category's own pictures on udozo.com (8 November 2026, the owner's request): a banner across the top of its
-- pages (4:1) and a spotlight image (a cut-out of what is sold there, drawn on a circle), both uploaded by admins.
ALTER TABLE "classified_categories" ADD COLUMN "banner_url" TEXT;
ALTER TABLE "classified_categories" ADD COLUMN "spotlight_url" TEXT;
