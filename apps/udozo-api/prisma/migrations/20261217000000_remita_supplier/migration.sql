-- Remita Vending Bills (SystemSpecs' RemitaConnect): electricity, cable TV, airtime, data and internet subscriptions.
-- Off until an admin turns it on and switches its markets on.
INSERT INTO "suppliers" ("code", "name", "categories", "coverage", "status", "enabled", "billing_model", "notes", "updated_at")
VALUES ('remita', 'Remita', ARRAY['bills', 'pay_tv', 'airtime', 'data']::"ProductCategory"[], 'Nigeria (its catalogue also lists Ghana, UK and US airtime)', 'pilot', false, 'prepaid_wallet',
        'Vending Bills from the prefunded Remita balance. Charges face value; the agreed commission is set as each offer''s discount. Production needs Vending approved on RemitaConnect and BitoCard''s server IP addresses whitelisted.', now())
ON CONFLICT ("code") DO NOTHING;
