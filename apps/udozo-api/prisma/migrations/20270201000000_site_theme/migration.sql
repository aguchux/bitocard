-- The product's colour theme (docs/UDOZO_SPINOFF_PLAN.md, step 3): Udozo's admins choose it; every Udozo app reads it.
CREATE TABLE "site_themes" (
    "key" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "published_by_id" UUID,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_themes_pkey" PRIMARY KEY ("key")
);
