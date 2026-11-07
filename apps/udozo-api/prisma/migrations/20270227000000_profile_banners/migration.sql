-- Udozo: a customer's profile cover, the wide picture across the top of their public seller page (`AvatarsService`,
-- media purpose `profile_banner`). Null shows Udozo's own drawn banner.
ALTER TABLE "customers" ADD COLUMN "banner_url" TEXT;
