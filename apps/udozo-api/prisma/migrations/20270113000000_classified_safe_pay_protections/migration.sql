-- AlterTable
ALTER TABLE "classified_safe_pay_settings" ADD COLUMN     "strike_limit" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "classified_sellers" ADD COLUMN     "safe_pay_cleared_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "classified_orders" ADD COLUMN     "payout_review" TEXT,
ADD COLUMN     "payout_review_note" TEXT,
ADD COLUMN     "payout_reviewed_at" TIMESTAMP(3),
ADD COLUMN     "payout_reviewed_by_id" UUID,
ADD COLUMN     "seller_payout_minor" BIGINT;

-- CreateIndex
CREATE INDEX "classified_orders_seller_id_payout_review_idx" ON "classified_orders"("seller_id", "payout_review");


ALTER TABLE "classified_safe_pay_settings" ADD CONSTRAINT "classified_safe_pay_settings_strike_limit_check" CHECK ("strike_limit" BETWEEN 1 AND 20);
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_payout_review_check" CHECK ("payout_review" IS NULL OR "payout_review" IN ('pending', 'approved', 'rejected'));
