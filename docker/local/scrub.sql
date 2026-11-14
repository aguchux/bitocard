-- Run on each local copy of a live database right after it is restored (docker/local/refresh.sh), so nothing done
-- locally can reach a real person, provider or account:
--   * every integration setting (API keys, secrets and the live addresses) is removed: email and SMS go to the outbox,
--     payments and suppliers are "not set up" or in sandbox, AI, push, storage, domains and WhatsApp stay off;
--   * resellers' webhook endpoints are switched off, so no event is delivered to their servers;
--   * browsers registered for push are forgotten;
--   * resellers' own supplier and gateway connections lose their credentials and are suspended;
--   * resellers' own AI keys are removed;
--   * every store's checkout runs in sandbox.
-- Accounts, passwords, sessions, catalogue, orders and balances are kept as they are, for testing with real data.

DELETE FROM "integration_settings";
UPDATE "webhook_endpoints" SET "status" = 'disabled', "disabled_reason" = 'local_copy', "disabled_at" = now() WHERE "status" <> 'disabled';
DELETE FROM "devices";
UPDATE "reseller_connections" SET "credentials_encrypted" = NULL, "status" = 'suspended' WHERE "credentials_encrypted" IS NOT NULL OR "status" = 'active';
DELETE FROM "ai_keys";
UPDATE "stores" SET "checkout_mode" = 'test' WHERE "checkout_mode" <> 'test';
