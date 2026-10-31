-- Notifications for every audience (admins, reseller staff, and storefront customers once they exist), supplier
-- notifications to resellers' own connections, and device push (browsers registered for Web Push, each notification
-- pushed once per device, push preferences).
-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('info', 'success', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('admin', 'reseller', 'customer');

-- CreateEnum
CREATE TYPE "DeviceChannel" AS ENUM ('web_push');

-- CreateEnum
CREATE TYPE "PushDeliveryStatus" AS ENUM ('pending', 'sent', 'failed');

-- AlterTable
ALTER TABLE "supplier_webhooks" ADD COLUMN     "connection_id" UUID;

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "user_id" UUID,
    "customer_id" UUID,
    "reseller_id" UUID,
    "store_id" UUID,
    "type" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "mode" "LedgerMode",
    "dedupe_key" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "user_id" UUID,
    "customer_id" UUID,
    "store_id" UUID,
    "session_id" UUID NOT NULL,
    "channel" "DeviceChannel" NOT NULL DEFAULT 'web_push',
    "endpoint" TEXT NOT NULL,
    "keys_encrypted" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "last_pushed_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "status" "PushDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "customer_id" UUID,
    "type" TEXT NOT NULL,
    "push" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_customer_id_created_at_idx" ON "notifications"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_customer_id_dedupe_key_key" ON "notifications"("customer_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "devices_endpoint_key" ON "devices"("endpoint");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex
CREATE INDEX "devices_customer_id_idx" ON "devices"("customer_id");

-- CreateIndex
CREATE INDEX "push_deliveries_status_next_attempt_at_idx" ON "push_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_deliveries_notification_id_device_id_key" ON "push_deliveries"("notification_id", "device_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_type_key" ON "notification_preferences"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_customer_id_type_key" ON "notification_preferences"("customer_id", "type");

-- CreateIndex
CREATE INDEX "supplier_webhooks_connection_id_received_at_idx" ON "supplier_webhooks"("connection_id", "received_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Exactly one recipient: a user (admins and reseller staff) or a storefront customer (with their store).
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_one_recipient" CHECK (
  ("audience" = 'customer' AND "user_id" IS NULL AND "customer_id" IS NOT NULL AND "store_id" IS NOT NULL)
  OR ("audience" <> 'customer' AND "user_id" IS NOT NULL AND "customer_id" IS NULL)
);
ALTER TABLE "devices" ADD CONSTRAINT "devices_one_owner" CHECK (
  ("audience" = 'customer' AND "user_id" IS NULL AND "customer_id" IS NOT NULL AND "store_id" IS NOT NULL)
  OR ("audience" <> 'customer' AND "user_id" IS NOT NULL AND "customer_id" IS NULL)
);
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_one_owner" CHECK (num_nonnulls("user_id", "customer_id") = 1);
