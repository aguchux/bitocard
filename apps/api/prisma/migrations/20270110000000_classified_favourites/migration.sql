-- BitoCard Shop, phase 1 step 2e: buyers' saved listings, with the price when saved so a drop can be shown.

-- CreateTable
CREATE TABLE "classified_favourites" (
    "customer_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "saved_price_minor" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_favourites_pkey" PRIMARY KEY ("customer_id","listing_id")
);

-- CreateIndex
CREATE INDEX "classified_favourites_customer_id_created_at_idx" ON "classified_favourites"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "classified_favourites_listing_id_idx" ON "classified_favourites"("listing_id");

-- AddForeignKey
ALTER TABLE "classified_favourites" ADD CONSTRAINT "classified_favourites_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_favourites" ADD CONSTRAINT "classified_favourites_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

