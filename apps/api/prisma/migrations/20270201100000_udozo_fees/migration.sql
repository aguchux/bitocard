-- Udozo's Seller HQ setup fee and Premium's free domain (docs/UDOZO_SPINOFF_PLAN.md, step 3). Unused on BitoCard.
CREATE TABLE "setup_fees" (
    "country" CHAR(2) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "amount_minor" BIGINT NOT NULL DEFAULT 0,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setup_fees_pkey" PRIMARY KEY ("country"),
    CONSTRAINT "setup_fees_amount" CHECK ("amount_minor" >= 0)
);

ALTER TABLE "resellers" ADD COLUMN "setup_fee_paid_at" TIMESTAMP(3),
ADD COLUMN "setup_fee_minor" BIGINT,
ADD COLUMN "setup_fee_currency" CHAR(3),
ADD COLUMN "setup_fee_store_id" UUID;

ALTER TABLE "store_domains" ADD COLUMN "free" BOOLEAN NOT NULL DEFAULT false;
