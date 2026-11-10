-- Udozo Connect, phase 7c (docs/UDOZO_CONNECT_PLAN.md, claims): what an auction left over after the storage owed and
-- Udozo's costs is the seller's, but only on a claim made within the market's `claim_days` of the sale. Finance checks a
-- claim and pays it into the seller's Udozo money; unclaimed by then, it becomes Udozo's.
ALTER TABLE "connect_auctions" ADD COLUMN "claim_by" TIMESTAMP(3),
ADD COLUMN "claim_reminded_at" TIMESTAMP(3),
ADD COLUMN "unclaimed_at" TIMESTAMP(3);
CREATE INDEX "connect_auctions_status_claim_by_idx" ON "connect_auctions"("status", "claim_by");

CREATE TABLE "connect_auction_claims" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "auction_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    -- requested (for finance to check), paid or rejected (the seller may claim again within the days).
    "status" TEXT NOT NULL DEFAULT 'requested',
    "note" TEXT,
    "decision_note" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connect_auction_claims_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connect_auction_claims_status_check" CHECK ("status" IN ('requested', 'paid', 'rejected')),
    CONSTRAINT "connect_auction_claims_amount_check" CHECK ("amount_minor" > 0)
);
CREATE UNIQUE INDEX "connect_auction_claims_number_key" ON "connect_auction_claims"("number");
-- One claim open or paid per lot.
CREATE UNIQUE INDEX "connect_auction_claims_open_key" ON "connect_auction_claims"("auction_id") WHERE "status" IN ('requested', 'paid');
CREATE INDEX "connect_auction_claims_status_created_at_idx" ON "connect_auction_claims"("status", "created_at");
ALTER TABLE "connect_auction_claims" ADD CONSTRAINT "connect_auction_claims_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "connect_auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connect_auction_claims" ADD CONSTRAINT "connect_auction_claims_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connect_auction_claims" ADD CONSTRAINT "connect_auction_claims_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
