-- Plans: a description admins edit, and fixed monthly prices per currency so resellers pay a set amount in their own
-- currency (without one, the US dollar price is converted at the day's rate when charged).
ALTER TABLE "plans" ADD COLUMN "description" TEXT;

UPDATE "plans" SET "description" = 'Everything you need to run your store and sell through the API.' WHERE "code" = 'standard';
UPDATE "plans" SET "description" = 'More protection, more reach and more tools, billed monthly from your wallet.' WHERE "code" = 'premium';

CREATE TABLE "plan_prices" (
    "plan_code" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("plan_code", "currency"),
    CONSTRAINT "plan_prices_amount_check" CHECK ("amount_minor" > 0)
);

ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "plans"("code") ON DELETE CASCADE ON UPDATE CASCADE;
