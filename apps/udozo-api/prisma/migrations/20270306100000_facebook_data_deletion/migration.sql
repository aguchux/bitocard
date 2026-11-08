-- Meta's data deletion callback (8 November 2026): each request, by the confirmation code Meta shows the person, with
-- what was removed. The Facebook account's id is not kept: removing it is the point.
CREATE TABLE "facebook_data_deletions" (
    "id" UUID NOT NULL,
    "confirmation_code" VARCHAR(32) NOT NULL,
    "customers" INTEGER NOT NULL DEFAULT 0,
    "people" INTEGER NOT NULL DEFAULT 0,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "facebook_data_deletions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "facebook_data_deletions_confirmation_code_key" ON "facebook_data_deletions"("confirmation_code");
