-- Udozo: a chat can be reported for pressure over a review (docs/UDOZO_RATINGS_PLAN.md, phase 1): a seller offering a
-- refund or discount to change a review, or a buyer demanding something for one. Listings keep the reasons they had.
ALTER TABLE "classified_reports" DROP CONSTRAINT "classified_reports_reason_check";
ALTER TABLE "classified_reports" ADD CONSTRAINT "classified_reports_reason_check" CHECK ("reason" IN ('scam', 'prohibited', 'wrong_category', 'duplicate', 'sold', 'offensive', 'other', 'review_pressure'));
