-- Udozo's personalised discovery (4 November 2026, approved; docs/UDOZO_PERSONALISATION_PLAN.md, phases 1 and 2): what
-- each person looks at, searches for and does (signed-in customers who have not turned it off, and visitors who accepted
-- all cookies, by an HMAC of their visitor ID), their interest profile per market, searches per day, each listing's
-- quality signals and the listings looked at in the same visits. Events are kept 90 days, idle profiles 180 days.
-- AlterTable
ALTER TABLE "customers" ADD COLUMN "personalisation_off_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "discovery_events" (
    "id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "session" TEXT,
    "kind" VARCHAR(20) NOT NULL,
    "listing_id" UUID,
    "category_id" UUID,
    "brand" TEXT,
    "model" TEXT,
    "area_id" UUID,
    "price_minor" BIGINT,
    "condition" TEXT,
    "query" VARCHAR(100),
    "filters" JSONB,
    "results" INTEGER,
    "sort" VARCHAR(20),
    "source" VARCHAR(40),
    "position" INTEGER,
    "seconds" INTEGER,
    "photos" INTEGER,
    "depth" INTEGER,
    "country" CHAR(2) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interest_profiles" (
    "id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "categories" JSONB NOT NULL DEFAULT '{}',
    "brands" JSONB NOT NULL DEFAULT '{}',
    "models" JSONB NOT NULL DEFAULT '{}',
    "areas" JSONB NOT NULL DEFAULT '{}',
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "prices" JSONB NOT NULL DEFAULT '{}',
    "searches" JSONB NOT NULL DEFAULT '[]',
    "seen" JSONB NOT NULL DEFAULT '{}',
    "excluded" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interest_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_query_days" (
    "country" CHAR(2) NOT NULL,
    "query" VARCHAR(100) NOT NULL,
    "day" DATE NOT NULL,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "zero_results" INTEGER NOT NULL DEFAULT 0,
    "subjects" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "contacts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "search_query_days_pkey" PRIMARY KEY ("country","query","day")
);

-- CreateTable
CREATE TABLE "listing_signals" (
    "listing_id" UUID NOT NULL,
    "quality" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "save_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contact_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refreshed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_signals_pkey" PRIMARY KEY ("listing_id")
);

-- CreateTable
CREATE TABLE "listing_neighbours" (
    "listing_id" UUID NOT NULL,
    "neighbour_id" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "listing_neighbours_pkey" PRIMARY KEY ("listing_id","neighbour_id")
);

-- CreateIndex
CREATE INDEX "discovery_events_subject_at_idx" ON "discovery_events"("subject", "at");

-- CreateIndex
CREATE INDEX "discovery_events_listing_id_at_idx" ON "discovery_events"("listing_id", "at");

-- CreateIndex
CREATE INDEX "discovery_events_country_kind_at_idx" ON "discovery_events"("country", "kind", "at");

-- CreateIndex
CREATE INDEX "interest_profiles_last_seen_at_idx" ON "interest_profiles"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "interest_profiles_subject_country_key" ON "interest_profiles"("subject", "country");

-- CreateIndex
CREATE INDEX "search_query_days_country_day_idx" ON "search_query_days"("country", "day");

-- The `personalisation` switch (Udozo's, global or market, off by default) starts on for Nigeria only; admins switch
-- the other markets on when ready. A setting an admin already made is left as it is.
INSERT INTO "feature_switches" ("id", "key", "country_code", "reseller_id", "enabled", "updated_at")
SELECT gen_random_uuid(), 'personalisation', 'NG', NULL, true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "feature_switches" f WHERE f."key" = 'personalisation' AND f."country_code" = 'NG' AND f."reseller_id" IS NULL);
