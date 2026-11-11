-- Udozo POS milestone 9 (docs/UDOZO_POS_PLAN.md): selling with no internet, and with it closing a shop, stock in
-- transit between shops and prices per shop.

-- A sale rung up offline on a linked till: its provisional number on the receipt (T2-0042), the device, when it arrived,
-- and what to look at (`oversold`: stock had run out; `held`: it needed units held for online orders; `staff_suspended`;
-- `unticked`: no longer at the till; `price_changed`: sold at an older price), until a manager marks it looked at.
ALTER TABLE "pos_sales"
  ADD COLUMN "offline" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "client_number" VARCHAR(20),
  ADD COLUMN "device_id" UUID,
  ADD COLUMN "uploaded_at" TIMESTAMP(3),
  ADD COLUMN "flags" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "flags_resolved_at" TIMESTAMP(3),
  ADD COLUMN "flags_resolved_by" VARCHAR(120);
CREATE INDEX "pos_sales_flagged_idx" ON "pos_sales" ("account_id", "created_at" DESC) WHERE "flags" <> '[]'::jsonb AND "flags_resolved_at" IS NULL;

-- When a linked device last synced and last uploaded sales made offline.
ALTER TABLE "pos_devices"
  ADD COLUMN "last_synced_at" TIMESTAMP(3),
  ADD COLUMN "last_upload_at" TIMESTAMP(3);

-- What an unlinked device uploaded of what it sold while it was linked: held for the owner to accept or reject.
CREATE TABLE "pos_offline_held" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "till_id" UUID,
  "entry" JSONB NOT NULL,
  "client_sale_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'held',
  "decided_by" VARCHAR(120),
  "decided_at" TIMESTAMP(3),
  "sale_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_offline_held_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_offline_held_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_offline_held_status_check" CHECK ("status" IN ('held', 'accepted', 'rejected'))
);
CREATE UNIQUE INDEX "pos_offline_held_client_key" ON "pos_offline_held" ("account_id", "client_sale_id");

-- Closing a shop: kept for its history, out of every list; its stock moved elsewhere first.
ALTER TABLE "pos_shops"
  ADD COLUMN "closed_at" TIMESTAMP(3),
  ADD COLUMN "closed_by" VARCHAR(120);
DROP INDEX "pos_shops_fulfils_online_key";
CREATE UNIQUE INDEX "pos_shops_fulfils_online_key" ON "pos_shops" ("account_id") WHERE "fulfils_online" AND "closed_at" IS NULL;

-- Stock on its way to a shop: counted in the shop's `incoming` (never sold, never online) until it is received.
ALTER TABLE "pos_stock_levels" ADD COLUMN "incoming" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pos_stock_levels" ADD CONSTRAINT "pos_stock_levels_incoming_check" CHECK ("incoming" >= 0);
ALTER TABLE "pos_stock_transfers"
  ADD COLUMN "status" VARCHAR(16) NOT NULL DEFAULT 'received',
  ADD COLUMN "received_at" TIMESTAMP(3),
  ADD COLUMN "received_by" VARCHAR(120),
  ADD COLUMN "received_lines" JSONB;
ALTER TABLE "pos_stock_transfers" ADD CONSTRAINT "pos_stock_transfers_status_check" CHECK ("status" IN ('in_transit', 'received', 'cancelled'));
UPDATE "pos_stock_transfers" SET "received_at" = "created_at", "received_by" = "by_name";
ALTER TABLE "pos_stock_movements" DROP CONSTRAINT "pos_stock_movements_reason_check";
ALTER TABLE "pos_stock_movements" ADD CONSTRAINT "pos_stock_movements_reason_check" CHECK ("reason" IN ('sale', 'refund', 'restock', 'count', 'damage', 'transfer_in', 'transfer_out', 'transfer_lost'));

-- A shop's own price for a listing (the listing's price elsewhere).
CREATE TABLE "pos_shop_prices" (
  "listing_id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "price_minor" BIGINT NOT NULL,
  "by_name" VARCHAR(120) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_shop_prices_pkey" PRIMARY KEY ("listing_id", "shop_id"),
  CONSTRAINT "pos_shop_prices_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_shop_prices_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pos_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_shop_prices_price_check" CHECK ("price_minor" > 0)
);

-- The levels, with stock on its way, never pass the listing's stock: what goes down outside the till comes from the
-- shops' own (the one fulfilling online orders first), then, last, from stock on its way.
CREATE OR REPLACE FUNCTION "pos_clamp_stock_levels"() RETURNS trigger AS $$
DECLARE
  excess INTEGER;
  level RECORD;
  taken INTEGER;
BEGIN
  SELECT COALESCE(SUM("quantity" + "incoming"), 0) - NEW."stock" INTO excess FROM "pos_stock_levels" WHERE "listing_id" = NEW."id";
  IF excess <= 0 THEN
    RETURN NEW;
  END IF;
  FOR level IN
    SELECT l."shop_id", l."quantity" FROM "pos_stock_levels" l JOIN "pos_shops" s ON s."id" = l."shop_id"
    WHERE l."listing_id" = NEW."id" AND l."quantity" > 0
    ORDER BY s."fulfils_online" DESC, s."position" DESC, s."created_at" DESC
    FOR UPDATE OF l
  LOOP
    taken := LEAST(excess, level."quantity");
    UPDATE "pos_stock_levels" SET "quantity" = "quantity" - taken, "updated_at" = CURRENT_TIMESTAMP WHERE "listing_id" = NEW."id" AND "shop_id" = level."shop_id";
    excess := excess - taken;
    EXIT WHEN excess <= 0;
  END LOOP;
  IF excess > 0 THEN
    FOR level IN SELECT "shop_id", "incoming" FROM "pos_stock_levels" WHERE "listing_id" = NEW."id" AND "incoming" > 0 FOR UPDATE LOOP
      taken := LEAST(excess, level."incoming");
      UPDATE "pos_stock_levels" SET "incoming" = "incoming" - taken, "updated_at" = CURRENT_TIMESTAMP WHERE "listing_id" = NEW."id" AND "shop_id" = level."shop_id";
      excess := excess - taken;
      EXIT WHEN excess <= 0;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
