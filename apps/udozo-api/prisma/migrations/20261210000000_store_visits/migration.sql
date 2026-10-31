-- Visits to reseller stores, counted without cookies: daily totals per address, and today's visitor hashes under a
-- daily random salt (both deleted once the day is over).
CREATE TABLE "store_visit_days" (
  "store_id" UUID NOT NULL,
  "host" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "views" INTEGER NOT NULL DEFAULT 0,
  "visitors" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "store_visit_days_pkey" PRIMARY KEY ("store_id", "host", "day"),
  CONSTRAINT "store_visit_days_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "store_visit_days_day_idx" ON "store_visit_days"("day");

CREATE TABLE "store_visitors" (
  "store_id" UUID NOT NULL,
  "day" DATE NOT NULL,
  "hash" TEXT NOT NULL,
  CONSTRAINT "store_visitors_pkey" PRIMARY KEY ("store_id", "day", "hash")
);
CREATE INDEX "store_visitors_day_idx" ON "store_visitors"("day");

CREATE TABLE "store_visit_salts" (
  "day" DATE NOT NULL,
  "salt" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_visit_salts_pkey" PRIMARY KEY ("day")
);
