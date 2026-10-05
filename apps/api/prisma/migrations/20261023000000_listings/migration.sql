-- Products are shown on BitoCard's own store only once an admin lists them; existing products start unlisted.
ALTER TABLE "products" ADD COLUMN "listed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "listed_at" TIMESTAMP(3);

-- CreateTable: products each reseller lists on their hosted storefront.
CREATE TABLE "reseller_listings" (
    "reseller_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reseller_listings_pkey" PRIMARY KEY ("reseller_id","product_id")
);

-- CreateIndex
CREATE INDEX "products_listed_idx" ON "products"("listed");

-- CreateIndex
CREATE INDEX "reseller_listings_product_id_idx" ON "reseller_listings"("product_id");

-- AddForeignKey
ALTER TABLE "reseller_listings" ADD CONSTRAINT "reseller_listings_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_listings" ADD CONSTRAINT "reseller_listings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
