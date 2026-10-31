-- Step-by-step sign-up: the email is confirmed with a code before the account exists.
CREATE TABLE "signup_verifications" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "token_hash" CHAR(64),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "signup_verifications_token_hash_key" ON "signup_verifications"("token_hash");

CREATE INDEX "signup_verifications_email_idx" ON "signup_verifications"("email");
