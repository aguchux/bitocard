-- Afrippa's escrow engine, step 3 item 2 (docs/CRYPTO_SPINOFF_PLAN.md): escrow ads. An Afrippa trader's ad lists the
-- payment methods it is paid through (the owner's own, in the ad's currency) and how long a buyer has to pay once an
-- order opens (15, 30 or 60 minutes). A sell ad still locks its coins; a buy ad locks nothing (no fiat on Afrippa).
-- BitoCard's instant ads (escrow false) are kept until step 3 retires them.
ALTER TABLE "p2p_ads" ADD COLUMN "escrow" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "p2p_ads" ADD COLUMN "payment_window_minutes" INTEGER;
ALTER TABLE "p2p_ads" ADD CONSTRAINT "p2p_ads_payment_window" CHECK (
  ("escrow" AND "payment_window_minutes" IN (15, 30, 60)) OR (NOT "escrow" AND "payment_window_minutes" IS NULL)
);
ALTER TABLE "p2p_ads" ADD CONSTRAINT "p2p_ads_escrow_locks_no_fiat" CHECK (NOT "escrow" OR ("fiat_locked_minor" = 0 AND "fiat_from_proceeds" = 0));

CREATE TABLE "p2p_ad_payment_methods" (
    "ad_id" UUID NOT NULL,
    "payment_method_id" UUID NOT NULL,

    CONSTRAINT "p2p_ad_payment_methods_pkey" PRIMARY KEY ("ad_id", "payment_method_id")
);

CREATE INDEX "p2p_ad_payment_methods_payment_method_id_idx" ON "p2p_ad_payment_methods"("payment_method_id");
ALTER TABLE "p2p_ad_payment_methods" ADD CONSTRAINT "p2p_ad_payment_methods_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "p2p_ads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "p2p_ad_payment_methods" ADD CONSTRAINT "p2p_ad_payment_methods_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "p2p_payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
