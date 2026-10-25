-- BitoCard Shop: feature keys sellers ask for (docs/BITOCARD_CLASSIFIEDS_PLAN.md, phase 1 step 5): admins add them to the
-- registry or dismiss them.
-- CreateTable
CREATE TABLE "classified_feature_suggestions" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "category_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "feature_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_feature_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "classified_feature_suggestions_status_name_key_idx" ON "classified_feature_suggestions"("status", "name_key");

-- CreateIndex
CREATE INDEX "classified_feature_suggestions_customer_id_created_at_idx" ON "classified_feature_suggestions"("customer_id", "created_at");

-- AddForeignKey
ALTER TABLE "classified_feature_suggestions" ADD CONSTRAINT "classified_feature_suggestions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_feature_suggestions" ADD CONSTRAINT "classified_feature_suggestions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "classified_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_feature_suggestions" ADD CONSTRAINT "classified_feature_suggestions_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "classified_features"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "classified_feature_suggestions" ADD CONSTRAINT "classified_feature_suggestions_status_check" CHECK ("status" IN ('open', 'added', 'dismissed'));
ALTER TABLE "classified_feature_suggestions" ADD CONSTRAINT "classified_feature_suggestions_name_check" CHECK (char_length("name") BETWEEN 2 AND 40 AND char_length("name_key") BETWEEN 2 AND 40);
ALTER TABLE "classified_feature_suggestions" ADD CONSTRAINT "classified_feature_suggestions_decided_check" CHECK (("status" = 'open') = ("decided_at" IS NULL));

-- One open suggestion per seller and name.
CREATE UNIQUE INDEX "classified_feature_suggestions_open_key" ON "classified_feature_suggestions"("customer_id", "name_key") WHERE "status" = 'open';
