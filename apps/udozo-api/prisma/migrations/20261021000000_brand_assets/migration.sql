-- Logos and card art uploaded for brand registry entries (Storefront > Brand registry).
-- CreateTable
CREATE TABLE "brand_assets" (
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "card_url" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_assets_pkey" PRIMARY KEY ("slug")
);
