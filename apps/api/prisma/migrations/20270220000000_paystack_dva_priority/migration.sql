ALTER TABLE "countries" ADD COLUMN "dva_gateway_priority" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "reserved_account_requests" ADD COLUMN "provider_customer_id" TEXT;
CREATE UNIQUE INDEX "reserved_account_requests_provider_provider_customer_id_key"
ON "reserved_account_requests"("provider", "provider_customer_id");
