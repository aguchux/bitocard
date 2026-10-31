-- Live chat: store customers with their store, resellers' teams with BitoCard.
CREATE TABLE "support_conversations" (
    "id" UUID NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "requester" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "store_id" UUID,
    "customer_id" UUID,
    "user_id" UUID,
    "assignee_id" UUID,
    "ticket_id" UUID,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_asked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alerted_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "support_chat_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "author" TEXT NOT NULL,
    "author_id" UUID,
    "author_name" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_conversations_queue_status_last_message_at_idx" ON "support_conversations"("queue", "status", "last_message_at");
CREATE INDEX "support_conversations_reseller_id_mode_status_idx" ON "support_conversations"("reseller_id", "mode", "status");
CREATE INDEX "support_conversations_customer_id_status_idx" ON "support_conversations"("customer_id", "status");
CREATE INDEX "support_conversations_user_id_status_idx" ON "support_conversations"("user_id", "status");
CREATE INDEX "support_chat_messages_conversation_id_created_at_idx" ON "support_chat_messages"("conversation_id", "created_at");

-- One open chat per customer, and per reseller account with BitoCard, so two tabs never start two.
CREATE UNIQUE INDEX "support_conversations_one_open_customer" ON "support_conversations"("customer_id") WHERE "status" <> 'closed' AND "customer_id" IS NOT NULL;
CREATE UNIQUE INDEX "support_conversations_one_open_reseller" ON "support_conversations"("reseller_id", "mode") WHERE "status" <> 'closed' AND "requester" = 'reseller';

ALTER TABLE "support_chat_messages" ADD CONSTRAINT "support_chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
