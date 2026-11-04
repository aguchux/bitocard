-- 4 November 2026, the owner's request.
-- Udozo's customers keep where they live (an area of their own country, apart from where their listings are), their
-- date of birth and their sex, each optional and set on their profile.
ALTER TABLE "customers" ADD COLUMN "area_id" UUID;
ALTER TABLE "customers" ADD COLUMN "birth_date" DATE;
ALTER TABLE "customers" ADD COLUMN "sex" TEXT;
ALTER TABLE "customers" ADD CONSTRAINT "customers_sex_check" CHECK ("sex" IS NULL OR "sex" IN ('female', 'male', 'unspecified'));
ALTER TABLE "customers" ADD CONSTRAINT "customers_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "classified_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "customers_area_id_idx" ON "customers"("area_id");
