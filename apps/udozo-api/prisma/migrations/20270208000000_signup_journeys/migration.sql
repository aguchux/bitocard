-- Udozo's sign-up journeys (Reports > Sign-up journeys): each person's way through sign-up on udozo.com or Seller HQ,
-- from the email they entered to an account they can use, step by step with why a step was refused, so admins can see
-- where people get stuck. Deleted 7 days after completing, or 30 days after the last step. Sign-up page visits are
-- counted per day, nothing else kept. Journeys are rolled into daily counts (no
-- details) before they are deleted, so the funnel and its blockers keep their history.

-- CreateTable
CREATE TABLE "signup_journeys" (
    "id" UUID NOT NULL,
    "surface" VARCHAR(10) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "method" VARCHAR(10) NOT NULL DEFAULT 'email',
    "country" CHAR(2),
    "account_id" UUID,
    "device" VARCHAR(60),
    "email_entered_at" TIMESTAMP(3),
    "email_verified_at" TIMESTAMP(3),
    "phone_entered_at" TIMESTAMP(3),
    "phone_verified_at" TIMESTAMP(3),
    "phone_skipped" BOOLEAN NOT NULL DEFAULT false,
    "account_created_at" TIMESTAMP(3),
    "signed_in_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "last_error_step" VARCHAR(30),
    "last_error_code" VARCHAR(60),
    "refusals" INTEGER NOT NULL DEFAULT 0,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_event_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_journeys_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "signup_journeys_surface_check" CHECK ("surface" IN ('udozo', 'shq'))
);

-- CreateTable
CREATE TABLE "signup_journey_events" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "step" VARCHAR(30) NOT NULL,
    "outcome" VARCHAR(10) NOT NULL,
    "code" VARCHAR(60),
    "param" VARCHAR(40),
    "device" VARCHAR(60),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_journey_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "signup_journey_events_outcome_check" CHECK ("outcome" IN ('ok', 'refused'))
);

-- CreateTable
CREATE TABLE "signup_visit_days" (
    "surface" VARCHAR(10) NOT NULL,
    "day" DATE NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "signup_visit_days_pkey" PRIMARY KEY ("surface","day")
);

-- CreateTable: journeys rolled into their start day before they are deleted, so the funnel keeps its history.
CREATE TABLE "signup_funnel_days" (
    "surface" VARCHAR(10) NOT NULL,
    "day" DATE NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "country" VARCHAR(2) NOT NULL DEFAULT '',
    "started" INTEGER NOT NULL DEFAULT 0,
    "email_entered" INTEGER NOT NULL DEFAULT 0,
    "email_verified" INTEGER NOT NULL DEFAULT 0,
    "phone_entered" INTEGER NOT NULL DEFAULT 0,
    "phone_verified" INTEGER NOT NULL DEFAULT 0,
    "account_created" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "minutes_to_complete" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "signup_funnel_days_pkey" PRIMARY KEY ("surface","day","method","country")
);

-- CreateTable
CREATE TABLE "signup_blocker_days" (
    "surface" VARCHAR(10) NOT NULL,
    "day" DATE NOT NULL,
    "step" VARCHAR(30) NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "country" VARCHAR(2) NOT NULL DEFAULT '',
    "refusals" INTEGER NOT NULL DEFAULT 0,
    "journeys" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "signup_blocker_days_pkey" PRIMARY KEY ("surface","day","step","code","country")
);

-- CreateIndex
CREATE INDEX "signup_journeys_surface_started_at_idx" ON "signup_journeys"("surface", "started_at");
CREATE INDEX "signup_journeys_surface_email_idx" ON "signup_journeys"("surface", "email");
CREATE INDEX "signup_journeys_completed_at_idx" ON "signup_journeys"("completed_at");
CREATE INDEX "signup_journeys_last_event_at_idx" ON "signup_journeys"("last_event_at");
-- One open journey per surface and email, so parallel steps add to the same one.
CREATE UNIQUE INDEX "signup_journeys_open_key" ON "signup_journeys"("surface", "email") WHERE "completed_at" IS NULL;
CREATE INDEX "signup_journey_events_journey_id_created_at_idx" ON "signup_journey_events"("journey_id", "created_at");

-- AddForeignKey
ALTER TABLE "signup_journey_events" ADD CONSTRAINT "signup_journey_events_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "signup_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
