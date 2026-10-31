-- Afrippa's escrow engine, step 3 item 1 (docs/CRYPTO_SPINOFF_PLAN.md): traders' saved payment methods. The buyer pays
-- the seller directly into one of these, shown to the counterparty only inside an open order. Details are encrypted;
-- the holder is the trader's verified name (live), never typed. Usable 24 hours after they are added.
CREATE TYPE "P2pPaymentMethodKind" AS ENUM ('bank', 'mobile_money', 'named');

CREATE TABLE "p2p_payment_methods" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "kind" "P2pPaymentMethodKind" NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "label" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "holder_name" TEXT NOT NULL,
    "details_encrypted" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "usable_from" TIMESTAMP(3) NOT NULL,
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "p2p_payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "p2p_payment_methods_customer_id_mode_idx" ON "p2p_payment_methods"("customer_id", "mode");
CREATE UNIQUE INDEX "p2p_payment_methods_one_each" ON "p2p_payment_methods"("customer_id", "mode", "fingerprint") WHERE "removed_at" IS NULL;

ALTER TABLE "p2p_payment_methods" ADD CONSTRAINT "p2p_payment_methods_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
