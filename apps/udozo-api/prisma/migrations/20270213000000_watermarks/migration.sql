-- Watermarked listing photos (docs/UDOZO_WATERMARK_PLAN.md, 4 November 2026): udozo.com serves every listing photo with
-- a watermark drawn in, from originals that are no longer public. Udozo's text is one row set by admins (default
-- `udozo.com`); a reseller's store may have its own where the `store_watermarks` switch allows it. Each text has a
-- version that changes with it, so photos get new addresses (and new cached copies) when the text changes.
CREATE TABLE "watermark_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "text" VARCHAR(30) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "watermark_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "watermark_settings_one_row" CHECK ("id" = 1),
    CONSTRAINT "watermark_settings_version_positive" CHECK ("version" >= 1)
);

INSERT INTO "watermark_settings" ("id", "text", "version") VALUES (1, 'udozo.com', 1);

ALTER TABLE "stores" ADD COLUMN "watermark_text" VARCHAR(30),
ADD COLUMN "watermark_version" INTEGER NOT NULL DEFAULT 0;

-- When a photo's stored original was made private (from then it is read only with credentials).
ALTER TABLE "classified_media" ADD COLUMN "private_at" TIMESTAMP(3);

CREATE INDEX "classified_media_kind_private_at_idx" ON "classified_media"("kind", "private_at");
