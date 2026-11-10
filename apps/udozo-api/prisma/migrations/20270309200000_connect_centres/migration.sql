-- Udozo Connect, phase 3 (docs/UDOZO_CONNECT_PLAN.md): who works at each centre (owner, managers, staff), its storage
-- places (shelves), and pausing (a partner's holiday or Udozo's reason) and closing. Every centre's partner is its owner.
-- AlterTable
ALTER TABLE "connect_centres" ADD COLUMN     "closed_at" TIMESTAMP(3),
ADD COLUMN     "closed_reason" TEXT,
ADD COLUMN     "paused_by" TEXT,
ADD COLUMN     "paused_reason" TEXT,
ADD COLUMN     "paused_until" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "connect_centre_members" (
    "id" UUID NOT NULL,
    "centre_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "added_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connect_centre_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_shelves" (
    "id" UUID NOT NULL,
    "centre_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "capacity" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connect_shelves_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connect_centre_members_customer_id_idx" ON "connect_centre_members"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "connect_centre_members_centre_id_customer_id_key" ON "connect_centre_members"("centre_id", "customer_id");

-- CreateIndex
CREATE INDEX "connect_shelves_centre_id_position_idx" ON "connect_shelves"("centre_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "connect_shelves_centre_id_code_key" ON "connect_shelves"("centre_id", "code");

-- AddForeignKey
ALTER TABLE "connect_centre_members" ADD CONSTRAINT "connect_centre_members_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "connect_centres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_centre_members" ADD CONSTRAINT "connect_centre_members_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_shelves" ADD CONSTRAINT "connect_shelves_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "connect_centres"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "connect_centre_members" ADD CONSTRAINT "connect_centre_members_role_check" CHECK ("role" IN ('owner', 'manager', 'staff'));
ALTER TABLE "connect_centres" ADD CONSTRAINT "connect_centres_paused_by_check" CHECK ("paused_by" IS NULL OR "paused_by" IN ('partner', 'udozo'));
ALTER TABLE "connect_shelves" ADD CONSTRAINT "connect_shelves_capacity_check" CHECK ("capacity" IS NULL OR "capacity" > 0);

-- Centres approved before this: their partner is their owner.
INSERT INTO "connect_centre_members" ("id", "centre_id", "customer_id", "role", "updated_at")
SELECT gen_random_uuid(), c."id", c."partner_id", 'owner', CURRENT_TIMESTAMP FROM "connect_centres" c
ON CONFLICT ("centre_id", "customer_id") DO NOTHING;
