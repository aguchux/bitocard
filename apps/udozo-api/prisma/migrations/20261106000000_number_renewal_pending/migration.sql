-- A virtual number renewal the supplier left unclear: kept so it is asked again unchanged, never a second month.
ALTER TABLE "virtual_numbers" ADD COLUMN "renewal_pending" TEXT, ADD COLUMN "renewal_cycles" INTEGER;
