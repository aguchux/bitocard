-- Check-out photos at a pickup's hand-over (docs/UDOZO_CONNECT_PLAN.md, phase 7a): the centre photographs what it gives
-- Udozo's collector before entering the pickup code. Sealed in the private bucket, at most 8 a pickup.
CREATE TABLE "connect_pickup_photos" (
    "id" UUID NOT NULL,
    "pickup_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "taken_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "connect_pickup_photos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "connect_pickup_photos_pickup_id_created_at_idx" ON "connect_pickup_photos"("pickup_id", "created_at");
ALTER TABLE "connect_pickup_photos" ADD CONSTRAINT "connect_pickup_photos_pickup_id_fkey" FOREIGN KEY ("pickup_id") REFERENCES "connect_pickups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
