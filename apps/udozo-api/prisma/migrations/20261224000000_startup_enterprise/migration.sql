-- The three plans: Startup (the free plan, renamed from Standard; its code stays "standard"), Premium, and Enterprise
-- (every feature, no limits). Enterprise starts hidden: an admin sets its price, then shows it or assigns it.
UPDATE "plans" SET "name" = 'Startup' WHERE "code" = 'standard' AND "name" = 'Standard';

INSERT INTO "plans" ("code", "name", "description", "price_cents", "features", "api_restrictions", "available", "sort_order", "limits", "updated_at")
VALUES (
  'enterprise',
  'Enterprise',
  'Everything BitoCard offers, with no limits, for businesses running fully on their own.',
  29900,
  ARRAY['own_integrations', 'own_payment_gateways', 'multiple_stores', 'custom_domains', 'international_selling', 'store_traffic', 'onchain_crypto', 'reseller_desks', 'chargeback_protection', 'priority_support', 'ai_assistant', 'team_members'],
  ARRAY[]::TEXT[],
  false,
  20,
  '{"stores": null, "domains_per_store": null, "own_connections": null, "ai_replies": null, "team_members": null, "webhook_endpoints": null}',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
