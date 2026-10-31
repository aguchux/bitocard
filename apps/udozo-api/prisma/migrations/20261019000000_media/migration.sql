-- Uploaded images: a media library of files in object storage (DigitalOcean Spaces), admin images for products,
-- supplier logos, and category icons and images.
-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('pending', 'ready');

-- AlterTable
ALTER TABLE "products" ADD COLUMN "image_url" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN "logo_url" TEXT;

-- CreateTable
CREATE TABLE "category_presentations" (
    "category" "ProductCategory" NOT NULL,
    "icon_url" TEXT,
    "image_url" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_presentations_pkey" PRIMARY KEY ("category")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "target_id" TEXT,
    "reseller_id" UUID,
    "uploaded_by_id" UUID,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "status" "MediaStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_assets_size_bytes_check" CHECK ("size_bytes" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_key_key" ON "media_assets"("key");

-- CreateIndex
CREATE INDEX "media_assets_reseller_id_status_created_at_idx" ON "media_assets"("reseller_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "media_assets_folder_status_idx" ON "media_assets"("folder", "status");

-- CreateIndex
CREATE INDEX "media_assets_status_expires_at_idx" ON "media_assets"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
