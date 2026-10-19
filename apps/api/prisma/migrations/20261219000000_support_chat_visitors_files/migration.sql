-- Live chat: signed-out visitors (name and email) and files sent in chats.
CREATE TABLE "support_visitors" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_visitors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "support_visitors_token_hash_key" ON "support_visitors"("token_hash");
CREATE INDEX "support_visitors_store_id_idx" ON "support_visitors"("store_id");

ALTER TABLE "support_conversations"
  ADD COLUMN "visitor_id" UUID,
  ADD COLUMN "requester_alerted_at" TIMESTAMP(3);
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "support_visitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- One open chat per visitor, as per customer.
CREATE UNIQUE INDEX "support_conversations_one_open_visitor" ON "support_conversations"("visitor_id") WHERE "status" <> 'closed' AND "visitor_id" IS NOT NULL;

CREATE TABLE "support_chat_attachments" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_chat_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "support_chat_attachments_conversation_id_idx" ON "support_chat_attachments"("conversation_id");
CREATE INDEX "support_chat_attachments_message_id_idx" ON "support_chat_attachments"("message_id");
ALTER TABLE "support_chat_attachments" ADD CONSTRAINT "support_chat_attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_chat_attachments" ADD CONSTRAINT "support_chat_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "support_chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
