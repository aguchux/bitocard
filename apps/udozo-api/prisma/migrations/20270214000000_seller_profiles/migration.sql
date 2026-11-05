-- Udozo: every account has a public seller page (`/<cc>/seller/<handle>`), named by a random handle so the page never
-- shows the account's own id. Existing accounts get one now; new ones by the column's default.
ALTER TABLE "customers" ADD COLUMN "seller_handle" VARCHAR(12);
UPDATE "customers" SET "seller_handle" = substr(md5(random()::text || "id"::text), 1, 10);
ALTER TABLE "customers" ALTER COLUMN "seller_handle" SET NOT NULL;
ALTER TABLE "customers" ALTER COLUMN "seller_handle" SET DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 10);
CREATE UNIQUE INDEX "customers_seller_handle_key" ON "customers"("seller_handle");
