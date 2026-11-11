-- Udozo POS milestone 4 (docs/UDOZO_POS_PLAN.md): Udozo collection accounts and next-day settlement. An owner on a
-- paid plan asks for a bank account number per till, opened by Udozo's gateways in Udozo's name for the shop, as
-- reserved accounts are. A transfer into it is re-read from the gateway and credited once to the owner's `pos_collected`
-- (less Udozo's collection fee: the gateway's fee plus the market's margin), and pays the sale waiting at that till for
-- that exact amount; any other transfer waits as unmatched for the owner to attach to a sale or keep. Each working day
-- the `pos` job settles the days before: the collected money moves to the owner's withdrawable balance and is paid to
-- their chosen bank account through the customer payouts. Behind `pos_collections` (global or country, off by default).

ALTER TYPE "AccountKind" ADD VALUE 'pos_collected';

-- Udozo's collection fee per market, set by finance: a margin on top of the gateway's own fee.
CREATE TABLE "pos_market_settings" (
  "country" VARCHAR(2) NOT NULL,
  -- The margin, in basis points of the transfer (100 is 1%).
  "collection_fee_bps" INTEGER NOT NULL DEFAULT 0,
  -- The margin's least and most per transfer (minor units); no cap when null.
  "collection_fee_min_minor" BIGINT NOT NULL DEFAULT 0,
  "collection_fee_cap_minor" BIGINT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_market_settings_pkey" PRIMARY KEY ("country"),
  CONSTRAINT "pos_market_settings_fee_check" CHECK ("collection_fee_bps" BETWEEN 0 AND 1000 AND "collection_fee_min_minor" >= 0 AND ("collection_fee_cap_minor" IS NULL OR "collection_fee_cap_minor" >= "collection_fee_min_minor"))
);

-- Where the owner's collections are paid each working day (one of their udozo.com payout bank accounts), and an admin's hold.
ALTER TABLE "pos_accounts" ADD COLUMN "settlement_bank_account_id" UUID;
ALTER TABLE "pos_accounts" ADD COLUMN "settlement_held_at" TIMESTAMP(3);
ALTER TABLE "pos_accounts" ADD COLUMN "settlement_hold_reason" VARCHAR(300);
ALTER TABLE "pos_accounts" ADD COLUMN "settlement_held_by" VARCHAR(120);
ALTER TABLE "pos_accounts" ADD CONSTRAINT "pos_accounts_settlement_bank_account_id_fkey" FOREIGN KEY ("settlement_bank_account_id") REFERENCES "customer_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A till's collection account: `opening` (asked, its number not back yet: a lost reply is still credited by its
-- reference), `active`, `refused` (every gateway said no) or `closed`. One open per till.
CREATE TABLE "pos_collection_accounts" (
  "id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "till_id" UUID,
  "mode" "LedgerMode" NOT NULL,
  "currency" VARCHAR(10) NOT NULL,
  -- Ours, the same on every attempt (`bc_rp_<mode>_<id>`), sent as the gateway's reference and carried back by every transfer.
  "reference" VARCHAR(64) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'opening',
  "provider" VARCHAR(32),
  "provider_account_id" VARCHAR(120),
  "bank_name" VARCHAR(120),
  "account_number" VARCHAR(20),
  "account_name" VARCHAR(120),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(300),
  "claimed_at" TIMESTAMP(3),
  "opened_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_collection_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_collection_accounts_status_check" CHECK ("status" IN ('opening', 'active', 'refused', 'closed'))
);
CREATE UNIQUE INDEX "pos_collection_accounts_reference_key" ON "pos_collection_accounts"("reference");
CREATE UNIQUE INDEX "pos_collection_accounts_till_open_key" ON "pos_collection_accounts"("till_id") WHERE "status" IN ('opening', 'active');
CREATE INDEX "pos_collection_accounts_account_idx" ON "pos_collection_accounts"("account_id", "created_at" DESC);
ALTER TABLE "pos_collection_accounts" ADD CONSTRAINT "pos_collection_accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_collection_accounts" ADD CONSTRAINT "pos_collection_accounts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pos_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_collection_accounts" ADD CONSTRAINT "pos_collection_accounts_till_id_fkey" FOREIGN KEY ("till_id") REFERENCES "pos_tills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A till waiting for a transfer into its collection account (`PT-000123`), holding the basket like a wallet request:
-- the transfer for exactly its amount makes the sale. `waiting`, `paid`, `cancelled`, `expired` or `failed` (the basket
-- changed at the shop before the money came: the transfer stays with the owner, unmatched).
CREATE TABLE "pos_transfer_requests" (
  "id" UUID NOT NULL,
  "number" SERIAL NOT NULL,
  "account_id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "till_id" UUID,
  "collection_account_id" UUID NOT NULL,
  "client_sale_id" UUID NOT NULL,
  "mode" "LedgerMode" NOT NULL,
  "currency" VARCHAR(10) NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "total_minor" BIGINT NOT NULL,
  "basket" JSONB NOT NULL,
  "sold_by_customer_id" UUID,
  "sold_by_name" VARCHAR(120) NOT NULL,
  "customer_id" UUID,
  "status" VARCHAR(16) NOT NULL DEFAULT 'waiting',
  "failure" VARCHAR(300),
  "sale_id" UUID,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "paid_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_transfer_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_transfer_requests_status_check" CHECK ("status" IN ('waiting', 'paid', 'cancelled', 'expired', 'failed')),
  CONSTRAINT "pos_transfer_requests_amount_check" CHECK ("amount_minor" > 0 AND "amount_minor" <= "total_minor")
);
CREATE UNIQUE INDEX "pos_transfer_requests_number_key" ON "pos_transfer_requests"("number");
CREATE INDEX "pos_transfer_requests_waiting_idx" ON "pos_transfer_requests"("collection_account_id", "status", "amount_minor");
CREATE INDEX "pos_transfer_requests_account_idx" ON "pos_transfer_requests"("account_id", "created_at" DESC);
ALTER TABLE "pos_transfer_requests" ADD CONSTRAINT "pos_transfer_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_transfer_requests" ADD CONSTRAINT "pos_transfer_requests_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pos_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_transfer_requests" ADD CONSTRAINT "pos_transfer_requests_till_id_fkey" FOREIGN KEY ("till_id") REFERENCES "pos_tills"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_transfer_requests" ADD CONSTRAINT "pos_transfer_requests_collection_account_id_fkey" FOREIGN KEY ("collection_account_id") REFERENCES "pos_collection_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_transfer_requests" ADD CONSTRAINT "pos_transfer_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "pos_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_transfer_requests" ADD CONSTRAINT "pos_transfer_requests_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "pos_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A day's settlement of an owner's collections (`PS-000123`): moved to their withdrawable balance in one entry
-- (`pos_settlement:<account>:<day>`, so a day is settled once) and paid to their bank account as a customer payout.
-- `paying` (the payout made: its own status says the rest) or `kept` (left in their Udozo payouts, with why).
CREATE TABLE "pos_settlements" (
  "id" UUID NOT NULL,
  "number" SERIAL NOT NULL,
  "account_id" UUID NOT NULL,
  "mode" "LedgerMode" NOT NULL,
  "currency" VARCHAR(10) NOT NULL,
  -- The working day it was settled on (the market's own date): it holds the collections before that day began.
  "day" DATE NOT NULL,
  "collections" INTEGER NOT NULL,
  "gross_minor" BIGINT NOT NULL,
  "fees_minor" BIGINT NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "kept_reason" VARCHAR(300),
  "bank_account_id" UUID,
  "payout_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_settlements_status_check" CHECK ("status" IN ('paying', 'kept')),
  CONSTRAINT "pos_settlements_amount_check" CHECK ("amount_minor" = "gross_minor" - "fees_minor" AND "amount_minor" >= 0)
);
CREATE UNIQUE INDEX "pos_settlements_number_key" ON "pos_settlements"("number");
CREATE UNIQUE INDEX "pos_settlements_account_day_key" ON "pos_settlements"("account_id", "day");
ALTER TABLE "pos_settlements" ADD CONSTRAINT "pos_settlements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_settlements" ADD CONSTRAINT "pos_settlements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "customer_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_settlements" ADD CONSTRAINT "pos_settlements_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "customer_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A transfer into a collection account (`PC-000123`), credited once per gateway transaction: `matched` (it paid a
-- sale), `unmatched` (waiting for the owner) or `kept` (the owner says it is for no sale; it is settled all the same).
CREATE TABLE "pos_collections" (
  "id" UUID NOT NULL,
  "number" SERIAL NOT NULL,
  "account_id" UUID NOT NULL,
  "collection_account_id" UUID,
  "shop_id" UUID,
  "till_id" UUID,
  "mode" "LedgerMode" NOT NULL,
  "currency" VARCHAR(10) NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "provider_transaction_id" VARCHAR(120) NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  -- What the gateway charged Udozo, and Udozo's whole fee (that and the margin); the owner gets the rest.
  "gateway_fee_minor" BIGINT NOT NULL DEFAULT 0,
  "fee_minor" BIGINT NOT NULL DEFAULT 0,
  "collected_minor" BIGINT NOT NULL,
  "payer_name" VARCHAR(120),
  "status" VARCHAR(16) NOT NULL DEFAULT 'unmatched',
  "sale_id" UUID,
  "transfer_request_id" UUID,
  "settlement_id" UUID,
  "note" VARCHAR(300),
  "decided_by_name" VARCHAR(120),
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_collections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_collections_status_check" CHECK ("status" IN ('matched', 'unmatched', 'kept')),
  CONSTRAINT "pos_collections_amount_check" CHECK ("amount_minor" > 0 AND "fee_minor" >= "gateway_fee_minor" AND "fee_minor" <= "amount_minor" AND "collected_minor" = "amount_minor" - "fee_minor")
);
CREATE UNIQUE INDEX "pos_collections_number_key" ON "pos_collections"("number");
CREATE UNIQUE INDEX "pos_collections_provider_transaction_key" ON "pos_collections"("provider", "provider_transaction_id");
CREATE INDEX "pos_collections_account_idx" ON "pos_collections"("account_id", "received_at" DESC);
CREATE INDEX "pos_collections_unsettled_idx" ON "pos_collections"("account_id", "received_at") WHERE "settlement_id" IS NULL;
ALTER TABLE "pos_collections" ADD CONSTRAINT "pos_collections_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_collections" ADD CONSTRAINT "pos_collections_collection_account_id_fkey" FOREIGN KEY ("collection_account_id") REFERENCES "pos_collection_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_collections" ADD CONSTRAINT "pos_collections_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pos_shops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_collections" ADD CONSTRAINT "pos_collections_till_id_fkey" FOREIGN KEY ("till_id") REFERENCES "pos_tills"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_collections" ADD CONSTRAINT "pos_collections_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "pos_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_collections" ADD CONSTRAINT "pos_collections_transfer_request_id_fkey" FOREIGN KEY ("transfer_request_id") REFERENCES "pos_transfer_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_collections" ADD CONSTRAINT "pos_collections_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "pos_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A sale part paid by transfer into a collection account, and the request it came through.
ALTER TABLE "pos_payments" ADD COLUMN "transfer_request_id" UUID;
ALTER TABLE "pos_payments" ADD CONSTRAINT "pos_payments_transfer_request_id_fkey" FOREIGN KEY ("transfer_request_id") REFERENCES "pos_transfer_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_payments" DROP CONSTRAINT "pos_payments_method_check";
ALTER TABLE "pos_payments" ADD CONSTRAINT "pos_payments_method_check" CHECK ("method" IN ('cash', 'transfer', 'card', 'other', 'udozo_wallet', 'credit', 'udozo_transfer'));
