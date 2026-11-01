-- udozo.com's Contact us form: messages from anyone, worked by Udozo's support team in the admin app.
CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "body" TEXT NOT NULL,
    "country" TEXT,
    "customer_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'new',
    "assignee_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "replied_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contact_messages_kind_check" CHECK ("kind" IN ('order', 'safe_pay', 'account', 'selling', 'reselling', 'report', 'partnership', 'other')),
    CONSTRAINT "contact_messages_status_check" CHECK ("status" IN ('new', 'open', 'waiting', 'resolved', 'spam'))
);

CREATE TABLE "contact_message_entries" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "author_id" UUID,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_message_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contact_message_entries_kind_check" CHECK ("kind" IN ('reply', 'note'))
);

CREATE UNIQUE INDEX "contact_messages_number_key" ON "contact_messages"("number");
CREATE INDEX "contact_messages_status_created_at_idx" ON "contact_messages"("status", "created_at");
CREATE INDEX "contact_messages_email_created_at_idx" ON "contact_messages"("email", "created_at");
CREATE INDEX "contact_message_entries_message_id_created_at_idx" ON "contact_message_entries"("message_id", "created_at");

ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contact_message_entries" ADD CONSTRAINT "contact_message_entries_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "contact_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
