-- Signing up and in with WhatsApp (8 November 2026, the owner's request): udozo.com asks for a sign-in, the person
-- sends its code from their WhatsApp to Udozo's number, and the browser that asked is signed in once the number's
-- account approves it (or once the account made there is ready). Only hashes of the code and the browser's token.
CREATE TABLE "whatsapp_sign_ins" (
    "id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "intent" VARCHAR(10) NOT NULL DEFAULT 'signin',
    "status" VARCHAR(12) NOT NULL DEFAULT 'waiting',
    "device" VARCHAR(60),
    "ref" VARCHAR(40),
    "contact_id" UUID,
    "customer_id" UUID,
    "signed_up" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "approved_at" TIMESTAMP(3),
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whatsapp_sign_ins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "whatsapp_sign_ins_code_hash_key" ON "whatsapp_sign_ins"("code_hash");
CREATE UNIQUE INDEX "whatsapp_sign_ins_token_hash_key" ON "whatsapp_sign_ins"("token_hash");
CREATE INDEX "whatsapp_sign_ins_expires_at_idx" ON "whatsapp_sign_ins"("expires_at");
