-- Seller HQ's sign-up confirms the owner's mobile number with a texted code, after the email and before the account
-- exists. Each code belongs to a confirmed email's sign-up (so nobody can send texts without first confirming an
-- inbox) and is removed with it after a day.
CREATE TABLE "signup_phone_verifications" (
    "id" UUID NOT NULL,
    "signup_verification_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_phone_verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "signup_phone_verifications_signup_verification_id_idx" ON "signup_phone_verifications"("signup_verification_id");

CREATE INDEX "signup_phone_verifications_phone_created_at_idx" ON "signup_phone_verifications"("phone", "created_at");

ALTER TABLE "signup_phone_verifications" ADD CONSTRAINT "signup_phone_verifications_signup_verification_id_fkey" FOREIGN KEY ("signup_verification_id") REFERENCES "signup_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
