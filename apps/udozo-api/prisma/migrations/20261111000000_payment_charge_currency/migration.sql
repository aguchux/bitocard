-- A payment the gateway charged in another currency (Stripe in US dollars where the account cannot take the local
-- one): what was charged. The payment's own amount and currency stay what the payer owed, as booked in the ledger.
ALTER TABLE "payments" ADD COLUMN "charge_amount_minor" BIGINT;
ALTER TABLE "payments" ADD COLUMN "charge_currency" CHAR(3);
ALTER TABLE "payments" ADD CONSTRAINT "payments_charge_check" CHECK (("charge_amount_minor" IS NULL) = ("charge_currency" IS NULL) AND ("charge_amount_minor" IS NULL OR "charge_amount_minor" > 0));
