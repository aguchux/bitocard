-- The airtime exchange (docs/BITOCARD_AIRTIME_EXCHANGE_PLAN.md, decided 15 November 2026): BitoCard buys customers'
-- unused airtime into its pool (sent to its collector lines by the network's own transfer service) and sells it at a
-- discount from the pool. Behind the `airtime_exchange` switch, off by default.

ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'airtime_inventory';
ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'airtime_payable';

-- Each network's rates and limits, per country. Rates in basis points of face value: what BitoCard pays sellers
-- (`sell_rate_bps`) and what buyers pay (`buy_rate_bps`), always less.
CREATE TABLE "airtime_networks" (
    "country" CHAR(2) NOT NULL,
    "network" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "sell_rate_bps" INTEGER NOT NULL DEFAULT 8000,
    "buy_rate_bps" INTEGER NOT NULL DEFAULT 8800,
    "min_amount_minor" BIGINT NOT NULL DEFAULT 10000,
    "max_amount_minor" BIGINT NOT NULL DEFAULT 500000,
    "seller_daily_minor" BIGINT NOT NULL DEFAULT 2000000,
    "credit_hold_hours" INTEGER NOT NULL DEFAULT 24,
    "transfer_steps" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "airtime_networks_pkey" PRIMARY KEY ("country", "network"),
    CONSTRAINT "airtime_networks_rates_check" CHECK ("sell_rate_bps" > 0 AND "buy_rate_bps" <= 10000 AND "sell_rate_bps" < "buy_rate_bps"),
    CONSTRAINT "airtime_networks_amounts_check" CHECK ("min_amount_minor" > 0 AND "max_amount_minor" >= "min_amount_minor" AND "seller_daily_minor" >= "min_amount_minor"),
    CONSTRAINT "airtime_networks_hold_check" CHECK ("credit_hold_hours" BETWEEN 0 AND 720)
);

-- BitoCard's own lines that receive sellers' airtime and send it on to buyers: several per network, each with its
-- own daily limits (the networks cap transfers per line), its counts for the day and the airtime believed on it.
CREATE TABLE "airtime_collector_lines" (
    "id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "network" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "daily_receive_minor" BIGINT NOT NULL DEFAULT 5000000,
    "daily_send_minor" BIGINT NOT NULL DEFAULT 5000000,
    "counter_day" DATE NOT NULL DEFAULT CURRENT_DATE,
    "received_today_minor" BIGINT NOT NULL DEFAULT 0,
    "sent_today_minor" BIGINT NOT NULL DEFAULT 0,
    "balance_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "airtime_collector_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "airtime_collector_lines_network_fkey" FOREIGN KEY ("country", "network") REFERENCES "airtime_networks"("country", "network") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "airtime_collector_lines_limits_check" CHECK ("daily_receive_minor" >= 0 AND "daily_send_minor" >= 0 AND "received_today_minor" >= 0 AND "sent_today_minor" >= 0)
);
CREATE UNIQUE INDEX "airtime_collector_lines_number_key" ON "airtime_collector_lines"("number");
CREATE INDEX "airtime_collector_lines_country_network_idx" ON "airtime_collector_lines"("country", "network");

-- The pool per mode and network, in face value: airtime held (`available`), the part promised to buyers not yet sent
-- (`reserved`), what it cost (`cost`, mirroring the `airtime_inventory` ledger account), and all-time totals.
CREATE TABLE "airtime_pools" (
    "mode" "LedgerMode" NOT NULL,
    "country" CHAR(2) NOT NULL,
    "network" TEXT NOT NULL,
    "available_minor" BIGINT NOT NULL DEFAULT 0,
    "reserved_minor" BIGINT NOT NULL DEFAULT 0,
    "cost_minor" BIGINT NOT NULL DEFAULT 0,
    "bought_minor" BIGINT NOT NULL DEFAULT 0,
    "sold_minor" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "airtime_pools_pkey" PRIMARY KEY ("mode", "country", "network"),
    CONSTRAINT "airtime_pools_network_fkey" FOREIGN KEY ("country", "network") REFERENCES "airtime_networks"("country", "network") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "airtime_pools_amounts_check" CHECK ("reserved_minor" >= 0 AND "available_minor" >= "reserved_minor" AND "cost_minor" >= 0 AND "bought_minor" >= 0 AND "sold_minor" >= 0)
);

-- A customer selling airtime to BitoCard (AS-000123): sent from their own confirmed number to the collector line
-- given, checked as received, then credited to their wallet once the hold has passed.
CREATE TABLE "airtime_sales" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "customer_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "network" TEXT NOT NULL,
    "line_id" UUID NOT NULL,
    "from_phone" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "payout_minor" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_transfer',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "credit_at" TIMESTAMP(3),
    "credited_at" TIMESTAMP(3),
    "overdue_alerted_at" TIMESTAMP(3),
    "decided_by" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "airtime_sales_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "airtime_sales_customer_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "airtime_sales_line_fkey" FOREIGN KEY ("line_id") REFERENCES "airtime_collector_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "airtime_sales_status_check" CHECK ("status" IN ('awaiting_transfer', 'sent', 'received', 'credited', 'expired', 'cancelled', 'not_received', 'reversed')),
    CONSTRAINT "airtime_sales_amounts_check" CHECK ("amount_minor" > 0 AND "payout_minor" >= 0 AND "payout_minor" <= "amount_minor")
);
CREATE UNIQUE INDEX "airtime_sales_number_key" ON "airtime_sales"("number");
CREATE INDEX "airtime_sales_customer_id_created_at_idx" ON "airtime_sales"("customer_id", "created_at");
CREATE INDEX "airtime_sales_status_expires_at_idx" ON "airtime_sales"("status", "expires_at");
CREATE INDEX "airtime_sales_status_credit_at_idx" ON "airtime_sales"("status", "credit_at");
CREATE INDEX "airtime_sales_mode_network_received_at_idx" ON "airtime_sales"("mode", "network", "received_at");

-- A customer buying airtime from the pool (AP-000123): paid from their wallet (locked), sent by BitoCard's staff
-- from a collector line within the hour, or refunded.
CREATE TABLE "airtime_purchases" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "customer_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "network" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "cost_minor" BIGINT,
    "line_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "decided_by" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "airtime_purchases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "airtime_purchases_customer_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "airtime_purchases_line_fkey" FOREIGN KEY ("line_id") REFERENCES "airtime_collector_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "airtime_purchases_status_check" CHECK ("status" IN ('paid', 'delivering', 'delivered', 'refunded')),
    CONSTRAINT "airtime_purchases_amounts_check" CHECK ("amount_minor" > 0 AND "price_minor" > 0 AND "price_minor" <= "amount_minor")
);
CREATE UNIQUE INDEX "airtime_purchases_number_key" ON "airtime_purchases"("number");
CREATE INDEX "airtime_purchases_customer_id_created_at_idx" ON "airtime_purchases"("customer_id", "created_at");
CREATE INDEX "airtime_purchases_status_expires_at_idx" ON "airtime_purchases"("status", "expires_at");
CREATE INDEX "airtime_purchases_mode_network_delivered_at_idx" ON "airtime_purchases"("mode", "network", "delivered_at");

-- Nigeria's four networks, at the owner's starting rates (sellers 80%, buyers 88%). The transfer steps are what
-- the networks' guides publish; operations check them against each network before switching the exchange on.
INSERT INTO "airtime_networks" ("country", "network", "name", "currency", "transfer_steps", "position") VALUES
  ('NG', 'mtn', 'MTN', 'NGN', 'Dial *600*{number}*{amount}*{pin}# from your MTN line. Set a transfer PIN first if you never have (the default is 0000).', 1),
  ('NG', 'airtel', 'Airtel', 'NGN', 'Dial *432# from your Airtel line, choose Me2U, then send {amount} to {number} with your PIN.', 2),
  ('NG', 'glo', 'Glo', 'NGN', 'Dial *131*{number}*{amount}*{pin}# from your Glo line.', 3),
  ('NG', '9mobile', '9mobile', 'NGN', 'Dial *223*{pin}*{amount}*{number}# from your 9mobile line.', 4);
