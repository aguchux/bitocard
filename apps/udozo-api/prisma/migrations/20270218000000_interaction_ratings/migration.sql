-- Udozo: private ratings of how sellers deal with buyers before a sale (docs/UDOZO_RATINGS_PLAN.md, phase 2). After a
-- chat, call, call back or contact request about a listing, the buyer rates the seller's responsiveness, helpfulness
-- and courtesy (1 to 5) with optional tags, once per listing. The seller sees only an anonymous summary of five or
-- more; admins see everything and can exclude a rating. Switch `classifieds_interaction_ratings`, off by default.

-- CreateTable
CREATE TABLE "classified_interaction_ratings" (
    "id" UUID NOT NULL,
    "rater_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "channel" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "responsiveness" INTEGER NOT NULL,
    "helpfulness" INTEGER NOT NULL,
    "courtesy" INTEGER NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "comment" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "excluded_at" TIMESTAMP(3),
    "excluded_by_id" UUID,
    "excluded_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classified_interaction_ratings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classified_interaction_ratings_scores" CHECK ("responsiveness" BETWEEN 1 AND 5 AND "helpfulness" BETWEEN 1 AND 5 AND "courtesy" BETWEEN 1 AND 5),
    CONSTRAINT "classified_interaction_ratings_channel" CHECK ("channel" IN ('chat', 'call', 'callback', 'contact')),
    CONSTRAINT "classified_interaction_ratings_parties" CHECK ("rater_id" <> "seller_id")
);

-- CreateTable
CREATE TABLE "classified_interaction_prompts" (
    "customer_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "shown_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissed_at" TIMESTAMP(3),

    CONSTRAINT "classified_interaction_prompts_pkey" PRIMARY KEY ("customer_id","listing_id")
);

-- CreateIndex
CREATE INDEX "classified_interaction_ratings_seller_id_created_at_idx" ON "classified_interaction_ratings"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "classified_interaction_ratings_rater_id_created_at_idx" ON "classified_interaction_ratings"("rater_id", "created_at");

-- CreateIndex
CREATE INDEX "classified_interaction_ratings_flagged_created_at_idx" ON "classified_interaction_ratings"("flagged", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "classified_interaction_ratings_rater_id_listing_id_key" ON "classified_interaction_ratings"("rater_id", "listing_id");

-- CreateIndex
CREATE INDEX "classified_interaction_prompts_customer_id_shown_at_idx" ON "classified_interaction_prompts"("customer_id", "shown_at");

-- AddForeignKey
ALTER TABLE "classified_interaction_ratings" ADD CONSTRAINT "classified_interaction_ratings_rater_id_fkey" FOREIGN KEY ("rater_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_interaction_ratings" ADD CONSTRAINT "classified_interaction_ratings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_interaction_ratings" ADD CONSTRAINT "classified_interaction_ratings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_interaction_prompts" ADD CONSTRAINT "classified_interaction_prompts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_interaction_prompts" ADD CONSTRAINT "classified_interaction_prompts_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

