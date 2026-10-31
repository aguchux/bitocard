-- Udozo's marketing (Marketplace > Marketing): sellers found on other marketplaces, or anyone an admin invites by email,
-- worked one stage at a time (reach out, invitation, onboarding, follow-up, feedback), every step logged. Accounts keep
-- the referral or invite code they signed up with, so an invite's sign-up is tracked.

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "signup_ref" TEXT;

-- CreateTable
CREATE TABLE "marketing_prospects" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "store_name" TEXT,
    "phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "email" TEXT,
    "country" CHAR(2) NOT NULL DEFAULT 'NG',
    "location" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "adverts" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'Jiji',
    "source_notes" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'reach_out',
    "stage_status" TEXT NOT NULL DEFAULT 'not_started',
    "status_reason" TEXT,
    "outcome" TEXT,
    "owner_id" UUID,
    "next_action" TEXT,
    "next_action_at" TIMESTAMP(3),
    "last_contact_at" TIMESTAMP(3),
    "follow_ups" INTEGER NOT NULL DEFAULT 0,
    "invite_code" TEXT NOT NULL,
    "invited_at" TIMESTAMP(3),
    "invite_emailed_at" TIMESTAMP(3),
    "clicked_at" TIMESTAMP(3),
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "do_not_contact" BOOLEAN NOT NULL DEFAULT false,
    "customer_id" UUID,
    "linked_at" TIMESTAMP(3),
    "feedback_rating" INTEGER,
    "would_recommend" BOOLEAN,
    "feedback_notes" TEXT,
    "advocacy" TEXT,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_prospects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_activities" (
    "id" UUID NOT NULL,
    "prospect_id" UUID NOT NULL,
    "actor_id" UUID,
    "kind" TEXT NOT NULL,
    "channel" TEXT,
    "template" TEXT,
    "body" TEXT,
    "replied" BOOLEAN,
    "outcome" TEXT,
    "stage" TEXT,
    "status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_signup_ref_idx" ON "customers"("signup_ref");
CREATE UNIQUE INDEX "marketing_prospects_invite_code_key" ON "marketing_prospects"("invite_code");
CREATE INDEX "marketing_prospects_stage_stage_status_idx" ON "marketing_prospects"("stage", "stage_status");
CREATE INDEX "marketing_prospects_owner_id_idx" ON "marketing_prospects"("owner_id");
CREATE INDEX "marketing_prospects_next_action_at_idx" ON "marketing_prospects"("next_action_at");
CREATE INDEX "marketing_prospects_customer_id_idx" ON "marketing_prospects"("customer_id");
CREATE INDEX "marketing_prospects_phones_idx" ON "marketing_prospects" USING GIN ("phones");
CREATE INDEX "marketing_prospects_email_idx" ON "marketing_prospects"("email");
CREATE INDEX "marketing_activities_prospect_id_created_at_idx" ON "marketing_activities"("prospect_id", "created_at");

-- AddForeignKey
ALTER TABLE "marketing_prospects" ADD CONSTRAINT "marketing_prospects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "marketing_prospects" ADD CONSTRAINT "marketing_prospects_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "marketing_prospects" ADD CONSTRAINT "marketing_prospects_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "marketing_activities" ADD CONSTRAINT "marketing_activities_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "marketing_prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_activities" ADD CONSTRAINT "marketing_activities_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The pipeline's values, kept to what the admin app offers.
ALTER TABLE "marketing_prospects" ADD CONSTRAINT "marketing_prospects_stage_check" CHECK ("stage" IN ('reach_out', 'invitation', 'onboarding', 'follow_up', 'feedback'));
ALTER TABLE "marketing_prospects" ADD CONSTRAINT "marketing_prospects_stage_status_check" CHECK ("stage_status" IN ('not_started', 'in_progress', 'waiting', 'done', 'skipped', 'failed'));
ALTER TABLE "marketing_prospects" ADD CONSTRAINT "marketing_prospects_outcome_check" CHECK ("outcome" IS NULL OR "outcome" IN ('signed_up', 'first_post', 'declined', 'no_response'));
ALTER TABLE "marketing_prospects" ADD CONSTRAINT "marketing_prospects_feedback_check" CHECK (("feedback_rating" IS NULL OR "feedback_rating" BETWEEN 1 AND 5) AND ("advocacy" IS NULL OR "advocacy" IN ('advocate', 'nurture')));
ALTER TABLE "marketing_prospects" ADD CONSTRAINT "marketing_prospects_contact_check" CHECK (cardinality("phones") > 0 OR "email" IS NOT NULL);
