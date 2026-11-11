-- Udozo POS milestone 8 (docs/UDOZO_POS_PLAN.md): several shops and yearly billing.
--
-- With more than one shop, a listing's one stock is split between them: `pos_stock_levels` holds what each shop has,
-- and what is in no shop is the online level (stock less every shop's). The levels never add up to more than the
-- listing's stock: when stock goes down anywhere outside the till (an online sale, the seller lowering it on
-- udozo.com), the trigger below takes the difference from the shop that fulfils online orders first, then the others.

-- Yearly prices per currency beside the monthly ones (none: no yearly billing for that plan in that currency).
ALTER TABLE "pos_plans" ADD COLUMN "yearly_prices" JSONB NOT NULL DEFAULT '{}';

-- How an account pays: monthly or yearly, and the interval taking over when the paid period ends.
ALTER TABLE "pos_accounts"
  ADD COLUMN "billing_interval" VARCHAR(8) NOT NULL DEFAULT 'month',
  ADD COLUMN "next_interval" VARCHAR(8),
  ADD CONSTRAINT "pos_accounts_interval_check" CHECK ("billing_interval" IN ('month', 'year') AND ("next_interval" IS NULL OR "next_interval" IN ('month', 'year')));
ALTER TABLE "pos_charges" ADD COLUMN "interval" VARCHAR(8) NOT NULL DEFAULT 'month';

-- The shop whose stock online orders take once the online level is used up: one an account, the first shop to begin.
ALTER TABLE "pos_shops" ADD COLUMN "fulfils_online" BOOLEAN NOT NULL DEFAULT false;
UPDATE "pos_shops" s SET "fulfils_online" = true
WHERE s."id" = (SELECT f."id" FROM "pos_shops" f WHERE f."account_id" = s."account_id" ORDER BY f."position", f."created_at", f."id" LIMIT 1);
CREATE UNIQUE INDEX "pos_shops_fulfils_online_key" ON "pos_shops" ("account_id") WHERE "fulfils_online";

CREATE TABLE "pos_stock_levels" (
  "listing_id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_stock_levels_pkey" PRIMARY KEY ("listing_id", "shop_id"),
  CONSTRAINT "pos_stock_levels_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_stock_levels_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "pos_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_stock_levels_quantity_check" CHECK ("quantity" >= 0)
);
CREATE INDEX "pos_stock_levels_shop_idx" ON "pos_stock_levels" ("shop_id");

-- Stock moved between shops, or between a shop and online (null): its lines as they were moved.
CREATE TABLE "pos_stock_transfers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "number" SERIAL NOT NULL,
  "account_id" UUID NOT NULL,
  "from_shop_id" UUID,
  "to_shop_id" UUID,
  "lines" JSONB NOT NULL,
  "note" VARCHAR(300),
  "by_name" VARCHAR(120) NOT NULL,
  "by_staff_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_stock_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_stock_transfers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_stock_transfers_from_shop_id_fkey" FOREIGN KEY ("from_shop_id") REFERENCES "pos_shops"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pos_stock_transfers_to_shop_id_fkey" FOREIGN KEY ("to_shop_id") REFERENCES "pos_shops"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "pos_stock_transfers_number_key" ON "pos_stock_transfers" ("number");
CREATE INDEX "pos_stock_transfers_account_idx" ON "pos_stock_transfers" ("account_id", "created_at" DESC);

-- Movements name transfers too.
ALTER TABLE "pos_stock_movements" DROP CONSTRAINT "pos_stock_movements_reason_check";
ALTER TABLE "pos_stock_movements" ADD CONSTRAINT "pos_stock_movements_reason_check" CHECK ("reason" IN ('sale', 'refund', 'restock', 'count', 'damage', 'transfer_in', 'transfer_out'));
ALTER TABLE "pos_stock_movements" ADD COLUMN "transfer_id" UUID;

-- Keeps the shops' levels within the listing's stock when it goes down outside the till.
CREATE FUNCTION "pos_clamp_stock_levels"() RETURNS trigger AS $$
DECLARE
  excess INTEGER;
  level RECORD;
  taken INTEGER;
BEGIN
  SELECT COALESCE(SUM("quantity"), 0) - NEW."stock" INTO excess FROM "pos_stock_levels" WHERE "listing_id" = NEW."id";
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pos_clamp_stock_levels" AFTER UPDATE OF "stock" ON "classified_listings"
FOR EACH ROW WHEN (NEW."stock" < OLD."stock") EXECUTE FUNCTION "pos_clamp_stock_levels"();
