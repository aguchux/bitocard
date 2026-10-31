-- Zendit (gift cards, airtime, bundles and data; eSIMs and bill payments later). Off until an admin switches it on.
INSERT INTO "suppliers" ("code", "name", "categories", "coverage", "status", "enabled", "billing_model", "notes", "updated_at")
VALUES ('zendit', 'Zendit', ARRAY['gift_cards', 'airtime', 'data']::"ProductCategory"[], 'Global (150+ countries)', 'pilot', false, 'prepaid_wallet',
        'Prepaid wallet in USD. Test mode uses a separate key and https://test-api.zendit.io/v1.', now())
ON CONFLICT ("code") DO NOTHING;
