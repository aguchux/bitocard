-- Udozo's mobile app, phase 0 (docs/UDOZO_MOBILE_APP_PLAN.md, 12 November 2026).

-- Sign in with Apple: the Apple account's subject, one account per store (never linked by a matching email), and its
-- refresh token (encrypted), kept only to revoke the app's access when the account is deleted, as Apple requires.
ALTER TABLE "customers" ADD COLUMN "apple_subject" TEXT;
ALTER TABLE "customers" ADD COLUMN "apple_refresh_token_encrypted" TEXT;
CREATE UNIQUE INDEX "customers_store_id_apple_subject_key" ON "customers"("store_id", "apple_subject");

-- A customer who deleted their account: their personal details are removed and the account is closed for good.
ALTER TABLE "customers" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Phones beside browsers: Firebase Cloud Messaging (Android), APNs (iPhone) and APNs VoIP tokens (calls only).
ALTER TYPE "DeviceChannel" ADD VALUE 'fcm';
ALTER TYPE "DeviceChannel" ADD VALUE 'apns';
ALTER TYPE "DeviceChannel" ADD VALUE 'apns_voip';
ALTER TABLE "devices" ADD COLUMN "app_version" VARCHAR(20);

-- Sign-up journeys made in the app are their own surface (the app says so in `Udozo-App`).
ALTER TABLE "signup_journeys" DROP CONSTRAINT "signup_journeys_surface_check";
ALTER TABLE "signup_journeys" ADD CONSTRAINT "signup_journeys_surface_check" CHECK ("surface" IN ('udozo', 'shq', 'app'));
