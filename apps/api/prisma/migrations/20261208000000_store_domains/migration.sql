-- Reseller stores' own domains: bought through BitoCard (Vercel's registrar) or connected; DNS on Vercel or the reseller's host.
ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'domain_revenue';

CREATE TYPE "DomainSource" AS ENUM ('purchased', 'connected');
CREATE TYPE "DomainStatus" AS ENUM ('purchasing', 'pending', 'active', 'failed', 'expired', 'suspended', 'removed');

CREATE TABLE "store_domains" (
  "id" UUID NOT NULL,
  "reseller_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "source" "DomainSource" NOT NULL,
  "status" "DomainStatus" NOT NULL DEFAULT 'pending',
  "dns_mode" TEXT NOT NULL DEFAULT 'external',
  "primary" BOOLEAN NOT NULL DEFAULT false,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "misconfigured" BOOLEAN NOT NULL DEFAULT true,
  "verification" JSONB,
  "last_checked_at" TIMESTAMP(3),
  "last_error" TEXT,
  "order_id" TEXT,
  "cost_cents" INTEGER,
  "price_cents" INTEGER,
  "hold_id" UUID,
  "expires_at" TIMESTAMP(3),
  "auto_renew" BOOLEAN NOT NULL DEFAULT true,
  "renewal_attempt_at" TIMESTAMP(3),
  "renewal_error" TEXT,
  "reminded_at" JSONB,
  "email_domain_id" TEXT,
  "email_status" TEXT,
  "email_records" JSONB,
  "mail_provider" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "store_domains_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "store_domains_dns_mode_check" CHECK ("dns_mode" IN ('vercel', 'external'))
);

CREATE INDEX "store_domains_reseller_id_idx" ON "store_domains"("reseller_id");
CREATE INDEX "store_domains_store_id_idx" ON "store_domains"("store_id");
CREATE INDEX "store_domains_status_idx" ON "store_domains"("status");
-- One store per domain while it is in use; a removed or failed one can be added again.
CREATE UNIQUE INDEX "store_domains_name_in_use_key" ON "store_domains"("name") WHERE "status" NOT IN ('removed', 'failed');
-- One primary domain per store.
CREATE UNIQUE INDEX "store_domains_primary_key" ON "store_domains"("store_id") WHERE "primary" = true;

ALTER TABLE "store_domains" ADD CONSTRAINT "store_domains_reseller_id_fkey" FOREIGN KEY ("reseller_id") REFERENCES "resellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_domains" ADD CONSTRAINT "store_domains_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
