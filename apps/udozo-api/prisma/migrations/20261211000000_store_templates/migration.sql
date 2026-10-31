-- Reseller store templates: each store's template, design variant, colour theme and (single product stores) its product,
-- and its own home page with published versions. Existing stores keep their look: All-in-one, Classic, Navy and pink.
ALTER TABLE "stores"
  ADD COLUMN "template" TEXT NOT NULL DEFAULT 'all_in_one',
  ADD COLUMN "variant" TEXT NOT NULL DEFAULT 'classic',
  ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'navy_pink',
  ADD COLUMN "focus" TEXT,
  ADD COLUMN "home_draft" JSONB,
  ADD COLUMN "home_published" JSONB,
  ADD COLUMN "home_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "home_published_at" TIMESTAMP(3);

CREATE TABLE "store_home_versions" (
  "id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "template" TEXT NOT NULL,
  "variant" TEXT NOT NULL,
  "sections" JSONB NOT NULL,
  "published_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_home_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "store_home_versions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "store_home_versions_store_id_version_key" ON "store_home_versions"("store_id", "version");
