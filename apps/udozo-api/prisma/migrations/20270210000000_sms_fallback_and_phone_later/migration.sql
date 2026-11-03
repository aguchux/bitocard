-- 3 November 2026, the owner's request.
-- A market's second SMS provider: a code the first provider could not send goes through it, and a resend goes through it
-- first (alternating after that). Never the same as the first, and never set without one.
ALTER TABLE "countries" ADD COLUMN "sms_fallback_provider" TEXT;
ALTER TABLE "countries" ADD CONSTRAINT "countries_sms_fallback_provider_check"
  CHECK ("sms_fallback_provider" IS NULL OR ("sms_provider" IS NOT NULL AND "sms_fallback_provider" <> "sms_provider"));

-- Udozo's customers may confirm their mobile later: when they chose to (at sign-up or on the confirm step), the account
-- is usable without it.
ALTER TABLE "customers" ADD COLUMN "phone_deferred_at" TIMESTAMP(3);
