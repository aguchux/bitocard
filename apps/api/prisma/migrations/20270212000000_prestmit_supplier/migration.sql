-- Prestmit is now a built gift card supplier as well as the buyer of customers' cards: its buyable cards are sold
-- from BitoCard's prefunded Prestmit Naira wallet. It stays switched off until an admin turns it on and switches a
-- gift card market on for it (Catalog > Suppliers).
UPDATE "suppliers"
SET "status" = 'pilot',
    "billing_model" = 'prepaid_wallet',
    "funding_currency" = 'NGN',
    "notes" = 'Gift cards both ways: buys customers'' cards (gift card selling) and sells its own from the prepaid Prestmit Naira wallet (fetch-buyable-giftcards, calculate-payment, buy/create). Withdrawal 2FA must be off on the account for API purchases; the account PIN is sent when set.',
    "updated_at" = now()
WHERE "code" = 'prestmit';
