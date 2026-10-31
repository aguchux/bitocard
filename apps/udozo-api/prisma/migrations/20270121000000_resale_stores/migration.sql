-- B2B reselling, stage 2 (docs/BITOCARD_B2B_RESELLING_PLAN.md): resellers' stores carrying suppliers' resale listings
-- (nothing about the item is stored here, only the reseller's price and their one note), auto-listing rules, and the
-- supplier and reseller's relationship with its chat and deals.

-- CreateTable
CREATE TABLE "resale_listings" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "relationship_id" UUID NOT NULL,
    "markup_bps" INTEGER,
    "fixed_price_minor" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "rule_id" UUID,
    "note" TEXT,
    "note_status" TEXT,
    "note_reason" TEXT,
    "note_submitted_at" TIMESTAMP(3),
    "note_decided_at" TIMESTAMP(3),
    "notified_state" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resale_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resale_rules" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "category_id" UUID,
    "markup_bps" INTEGER NOT NULL,
    "excluded_supplier_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resale_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resale_relationships" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "supplier_blocked_at" TIMESTAMP(3),
    "reseller_blocked_at" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3),
    "supplier_read_at" TIMESTAMP(3),
    "reseller_read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resale_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resale_messages" (
    "id" UUID NOT NULL,
    "relationship_id" UUID NOT NULL,
    "author" TEXT NOT NULL,
    "user_id" UUID,
    "body" TEXT NOT NULL,
    "deal_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resale_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resale_deals" (
    "id" UUID NOT NULL,
    "relationship_id" UUID NOT NULL,
    "listing_id" UUID,
    "discount_bps" INTEGER NOT NULL,
    "floor_bps" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'offered',
    "ends_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "ended_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resale_deals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resale_listings_listing_id_idx" ON "resale_listings"("listing_id");

-- CreateIndex
CREATE INDEX "resale_listings_reseller_id_status_idx" ON "resale_listings"("reseller_id", "status");

-- CreateIndex
CREATE INDEX "resale_listings_relationship_id_idx" ON "resale_listings"("relationship_id");

-- CreateIndex
CREATE UNIQUE INDEX "resale_listings_store_id_listing_id_key" ON "resale_listings"("store_id", "listing_id");

-- CreateIndex
CREATE INDEX "resale_rules_reseller_id_idx" ON "resale_rules"("reseller_id");

-- CreateIndex
CREATE INDEX "resale_rules_active_idx" ON "resale_rules"("active");

-- CreateIndex
CREATE INDEX "resale_relationships_reseller_id_last_message_at_idx" ON "resale_relationships"("reseller_id", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "resale_relationships_supplier_id_reseller_id_key" ON "resale_relationships"("supplier_id", "reseller_id");

-- CreateIndex
CREATE INDEX "resale_messages_relationship_id_created_at_idx" ON "resale_messages"("relationship_id", "created_at");

-- CreateIndex
CREATE INDEX "resale_deals_relationship_id_status_idx" ON "resale_deals"("relationship_id", "status");

-- AddForeignKey
ALTER TABLE "resale_listings" ADD CONSTRAINT "resale_listings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_listings" ADD CONSTRAINT "resale_listings_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_listings" ADD CONSTRAINT "resale_listings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_listings" ADD CONSTRAINT "resale_listings_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "resale_relationships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_listings" ADD CONSTRAINT "resale_listings_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "resale_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_rules" ADD CONSTRAINT "resale_rules_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_rules" ADD CONSTRAINT "resale_rules_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_rules" ADD CONSTRAINT "resale_rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "classified_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_relationships" ADD CONSTRAINT "resale_relationships_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_relationships" ADD CONSTRAINT "resale_relationships_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_messages" ADD CONSTRAINT "resale_messages_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "resale_relationships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_deals" ADD CONSTRAINT "resale_deals_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "resale_relationships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resale_deals" ADD CONSTRAINT "resale_deals_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The reseller's price is a markup or a fixed price, never both; a note's status only with a note.
ALTER TABLE "resale_listings" ADD CONSTRAINT "resale_listings_price_check" CHECK (
  ("markup_bps" IS NULL) <> ("fixed_price_minor" IS NULL)
  AND ("markup_bps" IS NULL OR "markup_bps" BETWEEN -10000 AND 20000)
  AND ("fixed_price_minor" IS NULL OR "fixed_price_minor" > 0)
);
ALTER TABLE "resale_listings" ADD CONSTRAINT "resale_listings_status_check" CHECK ("status" IN ('active', 'paused', 'removed'));
ALTER TABLE "resale_listings" ADD CONSTRAINT "resale_listings_note_check" CHECK (
  ("note" IS NULL AND "note_status" IS NULL)
  OR ("note" IS NOT NULL AND char_length("note") <= 140 AND "note_status" IN ('pending', 'approved', 'refused', 'withdrawn'))
);
ALTER TABLE "resale_rules" ADD CONSTRAINT "resale_rules_markup_check" CHECK ("markup_bps" BETWEEN 0 AND 20000);
ALTER TABLE "resale_messages" ADD CONSTRAINT "resale_messages_author_check" CHECK ("author" IN ('supplier', 'reseller', 'system'));
ALTER TABLE "resale_deals" ADD CONSTRAINT "resale_deals_terms_check" CHECK ("discount_bps" BETWEEN 1 AND 10000 AND "floor_bps" BETWEEN 0 AND "discount_bps");
ALTER TABLE "resale_deals" ADD CONSTRAINT "resale_deals_status_check" CHECK ("status" IN ('offered', 'active', 'declined', 'withdrawn', 'ended'));

-- At most one running deal per listing (or per supplier's every listing) for a reseller.
CREATE UNIQUE INDEX "resale_deals_active_key" ON "resale_deals" ("relationship_id", COALESCE("listing_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "status" = 'active';
-- Notes waiting for the supplier.
CREATE INDEX "resale_listings_note_pending_idx" ON "resale_listings" ("relationship_id") WHERE "note_status" = 'pending';
