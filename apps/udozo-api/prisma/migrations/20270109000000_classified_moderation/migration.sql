-- BitoCard Shop, phase 1 step 2d: automatic checks and moderation. Every reason a listing went to review, words that
-- are refused or reviewed, customers' reports, and sellers' standing (suspension). Plan: docs/BITOCARD_CLASSIFIEDS_PLAN.md.

-- AlterTable
ALTER TABLE "classified_listings" ADD COLUMN     "review_flags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "classified_prohibited_words" (
    "id" UUID NOT NULL,
    "country" CHAR(2),
    "phrase" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_prohibited_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classified_reports" (
    "id" UUID NOT NULL,
    "listing_id" UUID,
    "reported_customer_id" UUID,
    "reporter_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classified_sellers" (
    "customer_id" UUID NOT NULL,
    "suspended_at" TIMESTAMP(3),
    "suspended_reason" TEXT,
    "suspended_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classified_sellers_pkey" PRIMARY KEY ("customer_id")
);

-- CreateIndex
CREATE INDEX "classified_prohibited_words_country_idx" ON "classified_prohibited_words"("country");

-- CreateIndex
CREATE INDEX "classified_reports_status_created_at_idx" ON "classified_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "classified_reports_listing_id_status_idx" ON "classified_reports"("listing_id", "status");

-- AddForeignKey
ALTER TABLE "classified_reports" ADD CONSTRAINT "classified_reports_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_reports" ADD CONSTRAINT "classified_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_reports" ADD CONSTRAINT "classified_reports_reported_customer_id_fkey" FOREIGN KEY ("reported_customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_sellers" ADD CONSTRAINT "classified_sellers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "classified_prohibited_words" ADD CONSTRAINT "classified_prohibited_words_action_check" CHECK ("action" IN ('block', 'review'));
ALTER TABLE "classified_prohibited_words" ADD CONSTRAINT "classified_prohibited_words_phrase_check" CHECK ("phrase" = lower(btrim("phrase")) AND length("phrase") BETWEEN 2 AND 60);
CREATE UNIQUE INDEX "classified_prohibited_words_key" ON "classified_prohibited_words"(coalesce("country", ''), "phrase");
ALTER TABLE "classified_reports" ADD CONSTRAINT "classified_reports_target_check" CHECK ("listing_id" IS NOT NULL OR "reported_customer_id" IS NOT NULL);
ALTER TABLE "classified_reports" ADD CONSTRAINT "classified_reports_reason_check" CHECK ("reason" IN ('scam', 'prohibited', 'wrong_category', 'duplicate', 'sold', 'offensive', 'other'));
ALTER TABLE "classified_reports" ADD CONSTRAINT "classified_reports_status_check" CHECK ("status" IN ('open', 'dismissed', 'actioned'));
-- One open report per reporter and listing.
CREATE UNIQUE INDEX "classified_reports_open_key" ON "classified_reports"("reporter_id", "listing_id") WHERE "status" = 'open' AND "listing_id" IS NOT NULL;

-- Refused outright, everywhere: weapons, hard drugs and restricted medicines, fake money and card fraud.
INSERT INTO "classified_prohibited_words" ("id", "phrase", "action")
SELECT gen_random_uuid(), p, 'block' FROM unnest(ARRAY[
  'ammunition', 'firearm', 'firearms', 'pistol', 'revolver', 'rifle', 'shotgun', 'ak47', 'ak-47', 'bullets',
  'cocaine', 'heroin', 'methamphetamine', 'crystal meth', 'tramadol', 'codeine', 'rohypnol',
  'fake currency', 'fake naira', 'fake dollars', 'cloned card', 'cloned atm', 'atm card for sale', 'bvn details', 'carding'
]) AS p;
-- Sent to a moderator: words that are often scams or banned goods, but not always.
INSERT INTO "classified_prohibited_words" ("id", "phrase", "action")
SELECT gen_random_uuid(), p, 'review' FROM unnest(ARRAY[
  'gun', 'weed', 'skunk', 'counterfeit', 'replica', 'first copy', 'stolen', 'ivory', 'pangolin',
  'loan', 'investment', 'double your money', 'forex signals', 'deposit first', 'pay before viewing', 'inspection fee',
  'whatsapp me', 'telegram', 'western union'
]) AS p;
