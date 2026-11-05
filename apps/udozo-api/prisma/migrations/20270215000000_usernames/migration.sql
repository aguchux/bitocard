-- Udozo: usernames (docs/UDOZO_USERNAMES_PLAN.md). A customer who has posted the market's minimum of ads may choose a
-- username, and their seller page becomes `/<cc>/seller/<username>`. Stored lower-case, unique across every account;
-- changed at most once every 30 days. An old username redirects to the new one for 90 days and nobody else may take it
-- then (`customer_username_history`). The banner asking them to choose one stops after three "Not now".
ALTER TABLE "customers" ADD COLUMN "username" VARCHAR(24);
ALTER TABLE "customers" ADD COLUMN "username_set_at" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN "username_prompt_dismissals" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "customers" ADD CONSTRAINT "customers_username_lower" CHECK ("username" IS NULL OR "username" = lower("username"));
CREATE UNIQUE INDEX "customers_username_key" ON "customers"("username");

CREATE TABLE "customer_username_history" (
    "username" VARCHAR(24) NOT NULL,
    "customer_id" UUID NOT NULL,
    "released_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hold_until" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_username_history_pkey" PRIMARY KEY ("username")
);
CREATE INDEX "customer_username_history_customer_id_idx" ON "customer_username_history"("customer_id");
ALTER TABLE "customer_username_history" ADD CONSTRAINT "customer_username_history_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "classified_market_settings" ADD COLUMN "username_min_listings" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "classified_market_settings" ADD CONSTRAINT "classified_market_settings_username_min_listings" CHECK ("username_min_listings" BETWEEN 0 AND 100);
