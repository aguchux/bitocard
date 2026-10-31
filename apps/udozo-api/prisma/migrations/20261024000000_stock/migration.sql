-- BitoCard's own stock: codes (licence keys, gift cards) an admin adds, sold through the `stock` supplier.
CREATE TYPE "StockCodeStatus" AS ENUM ('available', 'sold', 'withdrawn');

CREATE TABLE "stock_codes" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "offer_id" UUID NOT NULL,
    "code_encrypted" TEXT NOT NULL,
    "pin_encrypted" TEXT,
    "code_hash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "status" "StockCodeStatus" NOT NULL DEFAULT 'available',
    "order_reference" TEXT,
    "added_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sold_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),

    CONSTRAINT "stock_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_codes_code_hash_key" ON "stock_codes"("code_hash");
CREATE UNIQUE INDEX "stock_codes_seq_key" ON "stock_codes"("seq");
CREATE INDEX "stock_codes_offer_id_status_seq_idx" ON "stock_codes"("offer_id", "status", "seq");
CREATE INDEX "stock_codes_order_reference_idx" ON "stock_codes"("order_reference");

ALTER TABLE "stock_codes" ADD CONSTRAINT "stock_codes_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "supplier_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The internal supplier that sells it. Not an outside supplier: no credentials, no sync, every market.
INSERT INTO "suppliers" ("code", "name", "categories", "coverage", "status", "enabled", "billing_model", "resale_approved", "notes", "updated_at")
VALUES ('stock', 'BitoCard stock', ARRAY['gift_cards', 'software']::"ProductCategory"[], 'BitoCard''s own inventory, every market', 'mvp_live', true, 'prepaid_wallet', true,
        'Codes BitoCard has bought and added under Catalog > Stock.', now())
ON CONFLICT ("code") DO NOTHING;
