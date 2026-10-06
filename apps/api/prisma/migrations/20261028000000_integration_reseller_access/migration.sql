-- Resellers' access to each integration, switched on by an admin. Integrations already offered somewhere keep working.
ALTER TABLE "integration_offers" ADD COLUMN "reseller_access" BOOLEAN NOT NULL DEFAULT false;

UPDATE "integration_offers" SET "reseller_access" = true WHERE "global" OR cardinality("countries") > 0;
