-- BitoCard's mobile app, phase 4 (docs/BITOCARD_MOBILE_APP_PLAN.md, 19 November 2026).

-- Phones beside browsers: Firebase Cloud Messaging (Android) and APNs (iPhone), with the app's version.
ALTER TYPE "DeviceChannel" ADD VALUE 'fcm';
ALTER TYPE "DeviceChannel" ADD VALUE 'apns';
ALTER TABLE "devices" ADD COLUMN "app_version" VARCHAR(20);

-- A customer who deleted their account: their personal details are removed and the account is closed for good.
ALTER TABLE "customers" ADD COLUMN "deleted_at" TIMESTAMP(3);
