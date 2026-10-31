-- The mobile number a reseller owner gave at sign-up (not confirmed), shown to BitoCard's admins.
ALTER TABLE "resellers" ADD COLUMN "signup_phone" TEXT;
