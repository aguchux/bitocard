-- Why a BitoCard Shop video failed (too long, unreadable, took too long), shown to the seller.
ALTER TABLE "classified_media" ADD COLUMN "failure_reason" TEXT;
