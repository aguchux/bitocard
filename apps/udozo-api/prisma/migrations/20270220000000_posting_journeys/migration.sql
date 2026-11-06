-- Udozo's posting journeys (Reports > Posting journeys): each ad's way from the seller pressing Sell to the ad live and
-- its first results (a view, a chat or call, a lead, sold), step by step with why a step was refused, so admins can see
-- where sellers get stuck posting. Steps come from the API's listing routes, from Post an ad's wizard on udozo.com (the
-- step reached or refused, never what was typed) and from moderators' decisions. Kept 30 days after the last step of an
-- ad that never went live, 90 days after one went live (30 after it sold, if sooner), then rolled into daily counts
-- with nobody's details. Moderators' rejections now carry a reason code, and every decision its time and moderator.

-- AlterTable
ALTER TABLE "classified_listings" ADD COLUMN     "review_reason_code" VARCHAR(20),
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by_id" UUID;

-- CreateTable
CREATE TABLE "posting_journeys" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "listing_id" UUID,
    "listing_ref" BIGINT,
    "sku" VARCHAR(16),
    "source" VARCHAR(20) NOT NULL DEFAULT 'unknown',
    "country" CHAR(2),
    "category_id" UUID,
    "top_category_id" UUID,
    "device" VARCHAR(60),
    "stage" VARCHAR(12) NOT NULL DEFAULT 'composing',
    "furthest_step" SMALLINT NOT NULL DEFAULT -1,
    "opened_at" TIMESTAMP(3),
    "draft_at" TIMESTAMP(3),
    "first_photo_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "review_queued_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "sent_back_at" TIMESTAMP(3),
    "resubmitted_at" TIMESTAMP(3),
    "live_at" TIMESTAMP(3),
    "live_via" VARCHAR(10),
    "first_view_at" TIMESTAMP(3),
    "first_chat_at" TIMESTAMP(3),
    "first_call_at" TIMESTAMP(3),
    "first_lead_at" TIMESTAMP(3),
    "sold_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "ended_reason" VARCHAR(20),
    "review_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviews" INTEGER NOT NULL DEFAULT 0,
    "sent_back_count" INTEGER NOT NULL DEFAULT 0,
    "submit_attempts" INTEGER NOT NULL DEFAULT 0,
    "refusals" INTEGER NOT NULL DEFAULT 0,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_step" VARCHAR(30),
    "last_error_code" VARCHAR(60),
    "last_reject_code" VARCHAR(20),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_event_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posting_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_journey_events" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "origin" VARCHAR(6) NOT NULL,
    "step" VARCHAR(30) NOT NULL,
    "outcome" VARCHAR(10) NOT NULL,
    "code" VARCHAR(60),
    "param" VARCHAR(40),
    "device" VARCHAR(60),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posting_journey_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_visit_days" (
    "day" DATE NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "signed_in" BOOLEAN NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "posting_visit_days_pkey" PRIMARY KEY ("day","source","signed_in")
);

-- CreateTable
CREATE TABLE "posting_funnel_days" (
    "day" DATE NOT NULL,
    "country" VARCHAR(2) NOT NULL DEFAULT '',
    "source" VARCHAR(20) NOT NULL,
    "top_category_id" VARCHAR(36) NOT NULL DEFAULT '',
    "started" INTEGER NOT NULL DEFAULT 0,
    "opened" INTEGER NOT NULL DEFAULT 0,
    "draft" INTEGER NOT NULL DEFAULT 0,
    "step_media" INTEGER NOT NULL DEFAULT 0,
    "step_details" INTEGER NOT NULL DEFAULT 0,
    "step_where" INTEGER NOT NULL DEFAULT 0,
    "step_place" INTEGER NOT NULL DEFAULT 0,
    "step_post" INTEGER NOT NULL DEFAULT 0,
    "submitted" INTEGER NOT NULL DEFAULT 0,
    "review_queued" INTEGER NOT NULL DEFAULT 0,
    "sent_back" INTEGER NOT NULL DEFAULT 0,
    "live" INTEGER NOT NULL DEFAULT 0,
    "live_direct" INTEGER NOT NULL DEFAULT 0,
    "live_after_review" INTEGER NOT NULL DEFAULT 0,
    "first_view" INTEGER NOT NULL DEFAULT 0,
    "first_contact" INTEGER NOT NULL DEFAULT 0,
    "first_lead" INTEGER NOT NULL DEFAULT 0,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "abandoned" INTEGER NOT NULL DEFAULT 0,
    "removed" INTEGER NOT NULL DEFAULT 0,
    "minutes_to_submit" BIGINT NOT NULL DEFAULT 0,
    "minutes_to_live" BIGINT NOT NULL DEFAULT 0,
    "minutes_to_first_contact" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "posting_funnel_days_pkey" PRIMARY KEY ("day","country","source","top_category_id")
);

-- CreateTable
CREATE TABLE "posting_blocker_days" (
    "day" DATE NOT NULL,
    "origin" VARCHAR(6) NOT NULL,
    "step" VARCHAR(30) NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "param" VARCHAR(40) NOT NULL DEFAULT '',
    "country" VARCHAR(2) NOT NULL DEFAULT '',
    "refusals" INTEGER NOT NULL DEFAULT 0,
    "journeys" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "posting_blocker_days_pkey" PRIMARY KEY ("day","origin","step","code","param","country")
);

-- CreateTable
CREATE TABLE "posting_review_days" (
    "day" DATE NOT NULL,
    "country" VARCHAR(2) NOT NULL DEFAULT '',
    "kind" VARCHAR(10) NOT NULL,
    "value" VARCHAR(30) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "minutes" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "posting_review_days_pkey" PRIMARY KEY ("day","country","kind","value")
);

-- CreateIndex
CREATE UNIQUE INDEX "posting_journeys_listing_id_key" ON "posting_journeys"("listing_id");

-- CreateIndex
CREATE INDEX "posting_journeys_started_at_idx" ON "posting_journeys"("started_at");

-- CreateIndex
CREATE INDEX "posting_journeys_last_event_at_idx" ON "posting_journeys"("last_event_at");

-- CreateIndex
CREATE INDEX "posting_journeys_stage_last_event_at_idx" ON "posting_journeys"("stage", "last_event_at");

-- CreateIndex
CREATE INDEX "posting_journeys_customer_id_last_event_at_idx" ON "posting_journeys"("customer_id", "last_event_at");

-- CreateIndex
CREATE INDEX "posting_journeys_country_started_at_idx" ON "posting_journeys"("country", "started_at");

-- CreateIndex
CREATE INDEX "posting_journey_events_journey_id_created_at_idx" ON "posting_journey_events"("journey_id", "created_at");

-- CreateIndex
CREATE INDEX "classified_listings_status_reviewed_at_idx" ON "classified_listings"("status", "reviewed_at");

-- One open journey per seller not yet tied to a listing, so parallel steps add to the same one.
CREATE UNIQUE INDEX "posting_journeys_open_key" ON "posting_journeys"("customer_id") WHERE "listing_id" IS NULL AND "stage" = 'composing';

ALTER TABLE "posting_journeys" ADD CONSTRAINT "posting_journeys_stage_check" CHECK ("stage" IN ('composing', 'in_review', 'sent_back', 'live', 'abandoned', 'removed'));
ALTER TABLE "posting_journeys" ADD CONSTRAINT "posting_journeys_furthest_step_check" CHECK ("furthest_step" BETWEEN -1 AND 5);
ALTER TABLE "posting_journey_events" ADD CONSTRAINT "posting_journey_events_origin_check" CHECK ("origin" IN ('api', 'client', 'system'));
ALTER TABLE "posting_journey_events" ADD CONSTRAINT "posting_journey_events_outcome_check" CHECK ("outcome" IN ('ok', 'refused'));
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_review_reason_code_check" CHECK ("review_reason_code" IS NULL OR "review_reason_code" IN ('photos', 'wrong_category', 'prohibited_item', 'misleading', 'contact_details', 'duplicate', 'other'));

-- AddForeignKey
ALTER TABLE "posting_journeys" ADD CONSTRAINT "posting_journeys_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_journey_events" ADD CONSTRAINT "posting_journey_events_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "posting_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

