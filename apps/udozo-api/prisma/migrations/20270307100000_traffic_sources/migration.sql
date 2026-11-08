-- Where udozo.com's visitors come from (8 November 2026, the owner's request): each landing on udozo.com from another
-- site, an ad or a campaign link (or typed in) counted per day by channel, source, medium, campaign, landing page kind
-- and market. Nothing about the visitor is kept (no address, no click id, no identifier), so it needs no consent. Kept
-- about 13 months.
CREATE TABLE "traffic_source_days" (
    "day" DATE NOT NULL,
    "country" CHAR(2) NOT NULL,
    "channel" VARCHAR(12) NOT NULL,
    "source" VARCHAR(60) NOT NULL,
    "medium" VARCHAR(40) NOT NULL DEFAULT '',
    "campaign" VARCHAR(80) NOT NULL DEFAULT '',
    "landing" VARCHAR(12) NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "traffic_source_days_pkey" PRIMARY KEY ("day", "country", "channel", "source", "medium", "campaign", "landing")
);
CREATE INDEX "traffic_source_days_day_idx" ON "traffic_source_days"("day");

-- Where an account came from (only for visitors who chose Accept all on udozo.com's cookie banner): the first source
-- of the visit that led to signing up, kept with the account.
ALTER TABLE "customers" ADD COLUMN "acquisition_channel" VARCHAR(12),
ADD COLUMN "acquisition_source" VARCHAR(60),
ADD COLUMN "acquisition_medium" VARCHAR(40),
ADD COLUMN "acquisition_campaign" VARCHAR(80),
ADD COLUMN "acquisition_landing" VARCHAR(12),
ADD COLUMN "acquired_at" TIMESTAMP(3);
CREATE INDEX "customers_acquisition_channel_acquisition_source_idx" ON "customers"("acquisition_channel", "acquisition_source");
