-- Udozo Connect, phase 2 (docs/UDOZO_CONNECT_PLAN.md, 9 November 2026, the owner's request): applications to run a
-- Connect Centre, Udozo's review and visit, each market's deposit and the states Connect is open in, the agreement by
-- version, the people who visit offices, and the centres approval makes. The deposit is held in the applicant's own
-- `connect_centre_deposit` ledger account.
-- AlterEnum
ALTER TYPE "AccountKind" ADD VALUE 'connect_centre_deposit';

-- CreateTable
CREATE TABLE "connect_settings" (
    "country" CHAR(2) NOT NULL,
    "deposit_minor" BIGINT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "connect_settings_pkey" PRIMARY KEY ("country")
);

-- CreateTable
CREATE TABLE "connect_states" (
    "state_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connect_states_pkey" PRIMARY KEY ("state_id")
);

-- CreateTable
CREATE TABLE "connect_agreement_acceptances" (
    "customer_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_agreement_acceptances_pkey" PRIMARY KEY ("customer_id","version")
);

-- CreateTable
CREATE TABLE "connect_visitors" (
    "id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "kind" TEXT NOT NULL,
    "trained_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connect_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_centre_applications" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "customer_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "business_name" TEXT,
    "registration_number" TEXT,
    "state_id" UUID,
    "area_id" UUID,
    "address" TEXT,
    "landmark" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "hours" TEXT,
    "phone" TEXT,
    "capacity" INTEGER,
    "person_name" TEXT,
    "person_role" TEXT,
    "agreement_version" TEXT,
    "currency" TEXT NOT NULL,
    "deposit_minor" BIGINT,
    "deposit_mode" TEXT,
    "deposit_paid_at" TIMESTAMP(3),
    "deposit_returned_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "changes_note" TEXT,
    "changes_at" TIMESTAMP(3),
    "visitor_id" UUID,
    "visit_at" TIMESTAMP(3),
    "visit_note" TEXT,
    "visit_confirmed_at" TIMESTAMP(3),
    "visit_reschedule_note" TEXT,
    "visited_at" TIMESTAMP(3),
    "visit_passed" BOOLEAN,
    "visit_report" TEXT,
    "decided_at" TIMESTAMP(3),
    "decided_by_id" UUID,
    "reject_reason" TEXT,
    "withdrawn_at" TIMESTAMP(3),
    "centre_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connect_centre_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_application_photos" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_application_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_centres" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "partner_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "state_id" UUID NOT NULL,
    "area_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "landmark" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "hours" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "deposit_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connect_centres_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connect_states_country_idx" ON "connect_states"("country");

-- CreateIndex
CREATE INDEX "connect_visitors_country_active_idx" ON "connect_visitors"("country", "active");

-- CreateIndex
CREATE UNIQUE INDEX "connect_centre_applications_number_key" ON "connect_centre_applications"("number");

-- CreateIndex
CREATE UNIQUE INDEX "connect_centre_applications_centre_id_key" ON "connect_centre_applications"("centre_id");

-- CreateIndex
CREATE INDEX "connect_centre_applications_status_submitted_at_idx" ON "connect_centre_applications"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "connect_centre_applications_customer_id_idx" ON "connect_centre_applications"("customer_id");

-- CreateIndex
CREATE INDEX "connect_centre_applications_country_status_idx" ON "connect_centre_applications"("country", "status");

-- CreateIndex
CREATE INDEX "connect_application_photos_application_id_position_idx" ON "connect_application_photos"("application_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "connect_centres_number_key" ON "connect_centres"("number");

-- CreateIndex
CREATE INDEX "connect_centres_country_state_id_status_idx" ON "connect_centres"("country", "state_id", "status");

-- CreateIndex
CREATE INDEX "connect_centres_partner_id_idx" ON "connect_centres"("partner_id");

-- AddForeignKey
ALTER TABLE "connect_agreement_acceptances" ADD CONSTRAINT "connect_agreement_acceptances_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_centre_applications" ADD CONSTRAINT "connect_centre_applications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_centre_applications" ADD CONSTRAINT "connect_centre_applications_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "classified_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_centre_applications" ADD CONSTRAINT "connect_centre_applications_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "classified_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_centre_applications" ADD CONSTRAINT "connect_centre_applications_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "connect_visitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_centre_applications" ADD CONSTRAINT "connect_centre_applications_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "connect_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_application_photos" ADD CONSTRAINT "connect_application_photos_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "connect_centre_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_centres" ADD CONSTRAINT "connect_centres_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_centres" ADD CONSTRAINT "connect_centres_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "classified_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connect_centres" ADD CONSTRAINT "connect_centres_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "classified_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One open application per customer at a time.
CREATE UNIQUE INDEX "connect_centre_applications_one_open" ON "connect_centre_applications" ("customer_id")
  WHERE "status" IN ('draft', 'submitted', 'changes_requested', 'visit_scheduled', 'visited');

ALTER TABLE "connect_centre_applications" ADD CONSTRAINT "connect_centre_applications_status_check"
  CHECK ("status" IN ('draft', 'submitted', 'changes_requested', 'visit_scheduled', 'visited', 'approved', 'rejected', 'withdrawn'));
ALTER TABLE "connect_centre_applications" ADD CONSTRAINT "connect_centre_applications_capacity_check" CHECK ("capacity" IS NULL OR "capacity" > 0);
ALTER TABLE "connect_centres" ADD CONSTRAINT "connect_centres_status_check" CHECK ("status" IN ('active', 'paused', 'closed'));
ALTER TABLE "connect_settings" ADD CONSTRAINT "connect_settings_deposit_check" CHECK ("deposit_minor" IS NULL OR "deposit_minor" >= 0);
ALTER TABLE "connect_visitors" ADD CONSTRAINT "connect_visitors_kind_check" CHECK ("kind" IN ('staff', 'agent'));
