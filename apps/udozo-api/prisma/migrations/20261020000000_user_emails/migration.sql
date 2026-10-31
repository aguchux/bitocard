-- A person's other confirmed email addresses; the primary stays users.email.
-- CreateTable
CREATE TABLE "user_emails" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "realm" "Realm" NOT NULL,
    "email" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_emails_realm_email_key" ON "user_emails"("realm", "email");

-- CreateIndex
CREATE INDEX "user_emails_user_id_idx" ON "user_emails"("user_id");

-- AddForeignKey
ALTER TABLE "user_emails" ADD CONSTRAINT "user_emails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
