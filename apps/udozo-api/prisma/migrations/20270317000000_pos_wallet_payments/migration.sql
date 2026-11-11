-- Udozo POS (docs/UDOZO_POS_PLAN.md, milestone 3): paying at the till from the buyer's Udozo wallet, the one method that
-- moves money through Udozo. The till asks for the wallet part of a basket (a QR code, or the buyer's Udozo mobile
-- number); the buyer confirms on udozo.com, and in that one transaction the sale is made (its stock taken) and the
-- money moves from the buyer's `customer_wallet` to the owner's `customer_withdrawable` (`pos_wallet:<request>`), paid
-- out after the market's payout hold. Off unless the market's `pos_wallet_payments` switch is on.

CREATE TABLE "pos_wallet_requests" (
  "id" UUID NOT NULL,
  "number" SERIAL NOT NULL,
  "account_id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "till_id" UUID,
  -- The link's token is shown once to the till; only its hash is kept.
  "token_hash" CHAR(64) NOT NULL,
  "client_sale_id" UUID NOT NULL,
  "mode" "LedgerMode" NOT NULL,
  "currency" VARCHAR(10) NOT NULL,
  -- The wallet part, and the whole sale it pays towards.
  "amount_minor" BIGINT NOT NULL,
  "total_minor" BIGINT NOT NULL,
  -- The basket as the till sent it (lines, discount, the other parts paid, note), made into the sale when paid.
  "basket" JSONB NOT NULL,
  "sold_by_customer_id" UUID,
  "sold_by_name" TEXT NOT NULL,
  -- Asked of one buyer by their mobile number, or (a QR code) whoever signed in pays.
  "buyer_customer_id" UUID,
  "status" VARCHAR(16) NOT NULL DEFAULT 'waiting',
  "sale_id" UUID,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "paid_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_wallet_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_wallet_requests_status_check" CHECK ("status" IN ('waiting', 'paid', 'declined', 'cancelled', 'expired')),
  CONSTRAINT "pos_wallet_requests_amount_check" CHECK ("amount_minor" > 0 AND "amount_minor" <= "total_minor"),
  CONSTRAINT "pos_wallet_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_wallet_requests_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pos_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_wallet_requests_till_id_fkey" FOREIGN KEY ("till_id") REFERENCES "pos_tills"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pos_wallet_requests_buyer_fkey" FOREIGN KEY ("buyer_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pos_wallet_requests_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "pos_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "pos_wallet_requests_number_key" ON "pos_wallet_requests" ("number");
CREATE UNIQUE INDEX "pos_wallet_requests_token_key" ON "pos_wallet_requests" ("token_hash");
CREATE INDEX "pos_wallet_requests_account_idx" ON "pos_wallet_requests" ("account_id", "created_at" DESC);
-- One waiting request per basket.
CREATE UNIQUE INDEX "pos_wallet_requests_waiting_key" ON "pos_wallet_requests" ("account_id", "client_sale_id") WHERE "status" = 'waiting';

ALTER TABLE "pos_payments" ADD COLUMN "wallet_request_id" UUID;
ALTER TABLE "pos_payments" ADD CONSTRAINT "pos_payments_wallet_request_id_fkey" FOREIGN KEY ("wallet_request_id") REFERENCES "pos_wallet_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_payments" DROP CONSTRAINT "pos_payments_method_check";
ALTER TABLE "pos_payments" ADD CONSTRAINT "pos_payments_method_check" CHECK ("method" IN ('cash', 'transfer', 'card', 'other', 'udozo_wallet'));
