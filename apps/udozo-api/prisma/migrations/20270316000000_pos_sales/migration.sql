-- Udozo POS milestone 3 (docs/UDOZO_POS_PLAN.md): ringing up sales at the till. A sale takes its units from the
-- listing's own stock (one inventory with udozo.com), never what online buyers hold, and records its lines and how it was
-- paid (cash with change, bank transfer to the shop's own account, card on the shop's own terminal, or other: recorded,
-- no money moves through Udozo). A refund puts the units back. Every change to stock made from the POS is kept.

-- Each shop numbers its sales: POS-000001, POS-000002…
ALTER TABLE "pos_shops" ADD COLUMN "sale_next" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "pos_sales" (
  "id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "till_id" UUID,
  "till_name" TEXT NOT NULL,
  "number" VARCHAR(16) NOT NULL,
  -- Made by the till, so a sale sent twice (a lost reply, or later from offline) is one sale.
  "client_sale_id" UUID NOT NULL,
  "currency" VARCHAR(10) NOT NULL,
  "subtotal_minor" BIGINT NOT NULL,
  "discount_minor" BIGINT NOT NULL DEFAULT 0,
  "vat_bps" INTEGER NOT NULL DEFAULT 0,
  "vat_minor" BIGINT NOT NULL DEFAULT 0,
  "total_minor" BIGINT NOT NULL,
  "change_minor" BIGINT NOT NULL DEFAULT 0,
  "status" VARCHAR(16) NOT NULL DEFAULT 'completed',
  -- Who rang it up: the owner now, staff from milestone 5.
  "sold_by_customer_id" UUID,
  "sold_by_name" TEXT NOT NULL,
  "note" VARCHAR(300),
  "refunded_at" TIMESTAMPTZ,
  "refund_reason" VARCHAR(300),
  "restocked" BOOLEAN,
  "client_created_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_sales_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_sales_status_check" CHECK ("status" IN ('completed', 'refunded')),
  CONSTRAINT "pos_sales_amounts_check" CHECK ("subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "discount_minor" <= "subtotal_minor" AND "vat_minor" >= 0 AND "total_minor" = "subtotal_minor" - "discount_minor" + "vat_minor" AND "change_minor" >= 0),
  CONSTRAINT "pos_sales_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_sales_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pos_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_sales_till_id_fkey" FOREIGN KEY ("till_id") REFERENCES "pos_tills"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "pos_sales_shop_number_key" ON "pos_sales" ("shop_id", "number");
CREATE UNIQUE INDEX "pos_sales_client_key" ON "pos_sales" ("account_id", "client_sale_id");
CREATE INDEX "pos_sales_account_created_idx" ON "pos_sales" ("account_id", "created_at" DESC);

CREATE TABLE "pos_sale_lines" (
  "id" UUID NOT NULL,
  "sale_id" UUID NOT NULL,
  "listing_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  -- As it was sold: a later change to the listing never rewrites the sale.
  "title" TEXT NOT NULL,
  "sku" VARCHAR(16),
  "barcode" VARCHAR(48),
  "quantity" INTEGER NOT NULL,
  "unit_price_minor" BIGINT NOT NULL,
  "discount_minor" BIGINT NOT NULL DEFAULT 0,
  "total_minor" BIGINT NOT NULL,
  CONSTRAINT "pos_sale_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_sale_lines_amounts_check" CHECK ("quantity" > 0 AND "unit_price_minor" >= 0 AND "discount_minor" >= 0 AND "discount_minor" <= "unit_price_minor" * "quantity" AND "total_minor" = "unit_price_minor" * "quantity" - "discount_minor"),
  CONSTRAINT "pos_sale_lines_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_sale_lines_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "pos_sale_lines_sale_idx" ON "pos_sale_lines" ("sale_id", "position");
CREATE INDEX "pos_sale_lines_listing_idx" ON "pos_sale_lines" ("listing_id");

CREATE TABLE "pos_payments" (
  "id" UUID NOT NULL,
  "sale_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "method" VARCHAR(16) NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  -- Cash handed over, and its change.
  "tendered_minor" BIGINT,
  "change_minor" BIGINT NOT NULL DEFAULT 0,
  "reference" VARCHAR(80),
  CONSTRAINT "pos_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_payments_method_check" CHECK ("method" IN ('cash', 'transfer', 'card', 'other')),
  CONSTRAINT "pos_payments_amounts_check" CHECK ("amount_minor" > 0 AND "change_minor" >= 0 AND ("tendered_minor" IS NULL OR "tendered_minor" = "amount_minor" + "change_minor")),
  CONSTRAINT "pos_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "pos_payments_sale_idx" ON "pos_payments" ("sale_id", "position");

-- Every change to a listing's stock made from the POS (or by its sales), oldest kept: the inventory's history.
CREATE TABLE "pos_stock_movements" (
  "id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "listing_id" UUID NOT NULL,
  "shop_id" UUID,
  "reason" VARCHAR(16) NOT NULL,
  "delta" INTEGER NOT NULL,
  "stock_after" INTEGER NOT NULL,
  "sale_id" UUID,
  "note" VARCHAR(200),
  "by_customer_id" UUID,
  "by_name" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_stock_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_stock_movements_reason_check" CHECK ("reason" IN ('sale', 'refund', 'restock', 'count', 'damage')),
  CONSTRAINT "pos_stock_movements_stock_check" CHECK ("stock_after" >= 0),
  CONSTRAINT "pos_stock_movements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_stock_movements_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_stock_movements_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "pos_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "pos_stock_movements_listing_idx" ON "pos_stock_movements" ("listing_id", "created_at" DESC);
CREATE INDEX "pos_stock_movements_account_idx" ON "pos_stock_movements" ("account_id", "created_at" DESC);
