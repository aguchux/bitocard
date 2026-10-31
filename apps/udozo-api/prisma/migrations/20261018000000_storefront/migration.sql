-- BitoCard's own storefront: brand presentation, admin-managed page layouts with published versions, and an index for sales per product.
-- CreateTable
CREATE TABLE "brands" (
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "description" TEXT,
    "logo_url" TEXT,
    "image_url" TEXT,
    "color" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "storefront_pages" (
    "key" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "published_by_id" UUID,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_pages_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "storefront_page_versions" (
    "page_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sections" JSONB NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_id" UUID,

    CONSTRAINT "storefront_page_versions_pkey" PRIMARY KEY ("page_key","version")
);

-- CreateIndex
CREATE INDEX "orders_product_id_completed_at_idx" ON "orders"("product_id", "completed_at");

-- AddForeignKey
ALTER TABLE "storefront_page_versions" ADD CONSTRAINT "storefront_page_versions_page_key_fkey" FOREIGN KEY ("page_key") REFERENCES "storefront_pages"("key") ON DELETE CASCADE ON UPDATE CASCADE;

