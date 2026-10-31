-- M10b: payment methods per market, storefront customers and checkout.

-- CreateEnum
CREATE TYPE "PaymentMethodPurpose" AS ENUM ('wallet_top_up', 'checkout');

-- CreateEnum
CREATE TYPE "CustomerCodePurpose" AS ENUM ('email_verification', 'password_reset');

-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('awaiting_payment', 'paid', 'completed', 'failed', 'refund_pending', 'refunded');

-- AlterTable
ALTER TABLE "resellers" ADD COLUMN     "house" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "holds" ADD COLUMN     "from_customer_minor" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customer_id" UUID;

-- CreateTable
CREATE TABLE "payment_methods" (
    "country_code" CHAR(2) NOT NULL,
    "purpose" "PaymentMethodPurpose" NOT NULL,
    "gateway" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("country_code","purpose","gateway")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "failed_sign_ins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_sign_in_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sessions" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_codes" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "purpose" "CustomerCodePurpose" NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkouts" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "quote_id" UUID NOT NULL,
    "payment_id" UUID,
    "order_id" UUID,
    "gateway" TEXT NOT NULL,
    "status" "CheckoutStatus" NOT NULL DEFAULT 'awaiting_payment',
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "refund_reference" TEXT,
    "refund_attempts" INTEGER NOT NULL DEFAULT 0,
    "refunded_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_store_id_email_key" ON "customers"("store_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sessions_token_hash_key" ON "customer_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "customer_sessions_customer_id_idx" ON "customer_sessions"("customer_id");

-- CreateIndex
CREATE INDEX "customer_codes_customer_id_purpose_idx" ON "customer_codes"("customer_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "checkouts_quote_id_key" ON "checkouts"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkouts_payment_id_key" ON "checkouts"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkouts_order_id_key" ON "checkouts"("order_id");

-- CreateIndex
CREATE INDEX "checkouts_customer_id_created_at_idx" ON "checkouts"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "checkouts_status_updated_at_idx" ON "checkouts"("status", "updated_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_codes" ADD CONSTRAINT "customer_codes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A checkout hold comes from what the customer paid instead of the wallet.
ALTER TABLE "holds" DROP CONSTRAINT "holds_amount_check";
ALTER TABLE "holds" ADD CONSTRAINT "holds_amount_check" CHECK ("amount_minor" > 0 AND "from_funding_minor" >= 0 AND "from_earnings_minor" >= 0 AND "from_customer_minor" >= 0 AND "from_funding_minor" + "from_earnings_minor" + "from_customer_minor" = "amount_minor");
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_amount_check" CHECK ("amount_minor" > 0);
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_gateway_check" CHECK ("gateway" IN ('stripe', 'flutterwave', 'monnify', 'pawapay'));

-- BitoCard's own store: one house account per market (created when that market's first checkout starts), and the one
-- with no country that owns the store (bitocard.com) and its customers.
CREATE UNIQUE INDEX "resellers_house_country_key" ON "resellers"("country") WHERE "house" AND "country" IS NOT NULL;
CREATE UNIQUE INDEX "resellers_house_root_key" ON "resellers"("house") WHERE "house" AND "country" IS NULL;
INSERT INTO "resellers" ("id", "name", "country", "status", "plan_code", "house", "verified_at", "updated_at")
VALUES ('00000000-0000-4000-8000-0000000000b1', 'BitoCard', NULL, 'active', 'premium', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "stores" ("id", "reseller_id", "name", "subdomain", "status", "published_at", "updated_at")
VALUES ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b1', 'BitoCard', 'bitocard', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Payment methods as they were: Flutterwave for wallet top-ups in the pilot markets. Everything else is switched on by
-- an admin per market (Settings > Markets), including every customer checkout method.
INSERT INTO "payment_methods" ("country_code", "purpose", "gateway", "enabled", "position", "updated_at")
SELECT "code", 'wallet_top_up', 'flutterwave', true, 0, CURRENT_TIMESTAMP FROM "countries" WHERE "code" IN ('NG', 'GH', 'KE');
