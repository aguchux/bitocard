-- Paystack joins the funding (wallet top-up) and payment (checkout) options of the markets it takes payments in,
-- each in its own currency: Nigeria (NGN), Ghana (GHS) and Kenya (KES). It goes after the methods already switched on;
-- admins reorder or switch it off in Settings > Markets > Payment methods. Live payers see it only once Paystack is
-- set up for live payments (a live secret key saved, Sandbox off).
INSERT INTO "payment_methods" ("country_code", "purpose", "gateway", "enabled", "position", "updated_at")
SELECT c."code", p."purpose"::"PaymentMethodPurpose", 'paystack', true,
       COALESCE((SELECT MAX(m."position") + 1 FROM "payment_methods" m WHERE m."country_code" = c."code" AND m."purpose" = p."purpose"::"PaymentMethodPurpose" AND m."enabled"), 0),
       CURRENT_TIMESTAMP
FROM "countries" c
CROSS JOIN (VALUES ('wallet_top_up'), ('checkout')) AS p("purpose")
WHERE (c."code", c."currency") IN (('NG', 'NGN'), ('GH', 'GHS'), ('KE', 'KES'))
ON CONFLICT ("country_code", "purpose", "gateway") DO UPDATE SET "enabled" = true, "position" = EXCLUDED."position", "updated_at" = CURRENT_TIMESTAMP;
