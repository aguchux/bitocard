-- Each reseller store's address on bitocard.com: its Cloudflare record and the storefront's Vercel domain.
ALTER TABLE "stores"
  ADD COLUMN "host_status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "host_name" TEXT,
  ADD COLUMN "host_record_id" TEXT,
  ADD COLUMN "host_error" TEXT,
  ADD COLUMN "host_synced_at" TIMESTAMP(3);

CREATE INDEX "stores_host_status_idx" ON "stores"("host_status");
