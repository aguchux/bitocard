-- Africa's Talking is now a built supplier: airtime and data bundles (its virtual numbers adapter is still to be built).
-- It stays switched off until an admin turns it on and switches its markets on.
UPDATE "suppliers"
SET "categories" = ARRAY['airtime', 'data', 'virtual_numbers']::"ProductCategory"[],
    "status" = 'pilot',
    "billing_model" = 'prepaid_wallet',
    "notes" = 'Airtime and data bundles from the prepaid Africa''s Talking wallet. Airtime costs the amount less the agreed discount; data plans and their costs are set by admins (no plan list in its API).',
    "updated_at" = now()
WHERE "code" = 'africas_talking';
