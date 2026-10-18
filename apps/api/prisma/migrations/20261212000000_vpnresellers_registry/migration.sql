INSERT INTO "suppliers" (
  "code", "name", "categories", "coverage", "status", "enabled", "billing_model",
  "min_first_deposit_minor", "min_top_up_minor", "resale_approved", "notes", "updated_at"
)
VALUES (
  'vpnresellers',
  'VPNresellers',
  ARRAY['software']::"ProductCategory"[],
  'Markets approved in writing only',
  'pilot',
  false,
  'prepaid_wallet',
  2500,
  2500,
  false,
  'Fixed-term VPN access pilot. Public material says active accounts are charged daily. Keep disabled until written downstream resale and market approval, lifecycle storage, secure delivery, safe ambiguous-create reconciliation, expiry automation and legal review are complete.',
  now()
)
ON CONFLICT ("code") DO NOTHING;
