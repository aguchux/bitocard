-- Udozo POS: staff PINs are 6 digits (11 November 2026, the owner's request). PINs set before are 4 digits: they still
-- sign in, once, and the person then chooses a 6-digit PIN before anything else (`pin_digits` 4).
ALTER TABLE "pos_staff" ADD COLUMN "pin_digits" SMALLINT;
UPDATE "pos_staff" SET "pin_digits" = 4 WHERE "pin_hash" IS NOT NULL;
