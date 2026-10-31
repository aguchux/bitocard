-- CreateEnum
CREATE TYPE "WebhookEndpointStatus" AS ENUM ('enabled', 'disabled');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('pending', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "endpoint_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMP(3),

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "WebhookEndpointStatus" NOT NULL DEFAULT 'enabled',
    "disabled_reason" TEXT,
    "disabled_at" TIMESTAMP(3),
    "secret_encrypted" TEXT NOT NULL,
    "previous_secret_encrypted" TEXT,
    "previous_secret_expires_at" TIMESTAMP(3),
    "failing_since" TIMESTAMP(3),
    "lease_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "last_response_status" INTEGER,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_attempts" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "success" BOOLEAN NOT NULL,
    "response_status" INTEGER,
    "response_body" TEXT,
    "error" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "events_seq_key" ON "events"("seq");

-- CreateIndex
CREATE INDEX "events_reseller_id_mode_seq_idx" ON "events"("reseller_id", "mode", "seq");

-- CreateIndex
CREATE INDEX "events_created_at_idx" ON "events"("created_at");

-- CreateIndex
CREATE INDEX "webhook_endpoints_reseller_id_mode_idx" ON "webhook_endpoints"("reseller_id", "mode");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx" ON "webhook_deliveries"("endpoint_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_event_id_endpoint_id_key" ON "webhook_deliveries"("event_id", "endpoint_id");

-- CreateIndex
CREATE INDEX "webhook_attempts_delivery_id_created_at_idx" ON "webhook_attempts"("delivery_id", "created_at");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_attempts" ADD CONSTRAINT "webhook_attempts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "webhook_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Events still waiting to be fanned out to endpoints (the outbox), oldest first.
CREATE INDEX "events_undispatched_idx" ON "events"("seq") WHERE "dispatched_at" IS NULL;
