-- Udozo: Anjio's seller scores (docs/UDOZO_RATINGS_PLAN.md, phase 3). Each night the seller-scores job works out
-- every active seller's response, attention, pricing, costing, reliability, satisfaction and salesmanship (0-100, null
-- below a minimum sample), an overall score and band, tips for the seller, and a short summary Anjio writes from those
-- figures; a monthly snapshot is kept 24 months. Public only where seller_scores is on; summaries where
-- seller_score_summaries is.

-- CreateTable
CREATE TABLE "classified_seller_scores" (
    "seller_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "overall_score" INTEGER,
    "band" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "inputs_hash" TEXT,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary_text" TEXT,
    "summary_provider" TEXT,
    "summary_model" TEXT,
    "summary_input_tokens" INTEGER,
    "summary_output_tokens" INTEGER,
    "summary_cost_micros" BIGINT,
    "summary_inputs" JSONB,
    "summary_written_at" TIMESTAMP(3),
    "summary_hidden_at" TIMESTAMP(3),
    "summary_hidden_reason" TEXT,
    "summary_reported_at" TIMESTAMP(3),
    "summary_report" TEXT,

    CONSTRAINT "classified_seller_scores_pkey" PRIMARY KEY ("seller_id")
);

-- CreateTable
CREATE TABLE "classified_seller_score_months" (
    "seller_id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "country" CHAR(2) NOT NULL,
    "overall_score" INTEGER,
    "band" TEXT,
    "metrics" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "classified_seller_score_months_pkey" PRIMARY KEY ("seller_id","month")
);

-- CreateIndex
CREATE INDEX "classified_seller_scores_country_computed_at_idx" ON "classified_seller_scores"("country", "computed_at");

-- CreateIndex
CREATE INDEX "classified_seller_score_months_month_idx" ON "classified_seller_score_months"("month");

-- AddForeignKey
ALTER TABLE "classified_seller_scores" ADD CONSTRAINT "classified_seller_scores_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_seller_score_months" ADD CONSTRAINT "classified_seller_score_months_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

