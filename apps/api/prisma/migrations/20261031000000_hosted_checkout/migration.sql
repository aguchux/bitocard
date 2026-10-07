-- Checkout on resellers' hosted stores, payments into resellers' own gateways, and refunds of delivered checkout orders.

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "checkout_mode" "LedgerMode" NOT NULL DEFAULT 'test';

-- AlterTable
ALTER TABLE "checkouts" ADD COLUMN     "connection_id" UUID,
ADD COLUMN     "fee_charge_id" UUID,
ADD COLUMN     "refund_kind" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "connection_id" UUID;

-- AlterTable
ALTER TABLE "earnings_lots" ADD COLUMN     "reversed_at" TIMESTAMP(3);

-- bitocard.com's own store sells live (its sandbox is the Customer checkout integration's switch).
UPDATE "stores" SET "checkout_mode" = 'live' WHERE "id" = '00000000-0000-4000-8000-0000000000b2';
