-- Mobile money exists in every market, switched off, with customer verification on (money sent to a wallet is a payout).
INSERT INTO "country_categories" ("country_code", "category", "enabled", "customer_verification")
SELECT "code", 'mobile_money'::"ProductCategory", false, true FROM "countries"
ON CONFLICT ("country_code", "category") DO NOTHING;

-- pawaPay (mobile money payouts across its African markets). Off until an admin switches it on.
INSERT INTO "suppliers" ("code", "name", "categories", "coverage", "status", "enabled", "billing_model", "notes", "updated_at")
VALUES ('pawapay', 'pawaPay', ARRAY['mobile_money']::"ProductCategory"[], 'Sub-Saharan Africa: the countries and providers on the pawaPay account', 'pilot', false, 'prepaid_wallet',
        'Payouts from prefunded pawaPay wallets, one per country in its currency. Fees are taken on success.', now())
ON CONFLICT ("code") DO NOTHING;
