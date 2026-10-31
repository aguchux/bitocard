-- Support tickets: customers to their store, resellers to BitoCard, with messages (staff notes kept from requesters).
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "reseller_id" UUID NOT NULL,
    "mode" "LedgerMode" NOT NULL,
    "requester" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "subject" TEXT NOT NULL,
    "store_id" UUID,
    "customer_id" UUID,
    "customer_reference" TEXT,
    "user_id" UUID,
    "order_id" UUID,
    "checkout_id" UUID,
    "source" TEXT NOT NULL DEFAULT 'form',
    "assignee_id" UUID,
    "escalated_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "support_ticket_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author" TEXT NOT NULL,
    "author_id" UUID,
    "author_name" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'all',
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");
CREATE INDEX "support_tickets_reseller_id_mode_status_idx" ON "support_tickets"("reseller_id", "mode", "status");
CREATE INDEX "support_tickets_queue_status_last_message_at_idx" ON "support_tickets"("queue", "status", "last_message_at");
CREATE INDEX "support_tickets_customer_id_created_at_idx" ON "support_tickets"("customer_id", "created_at");
CREATE INDEX "support_ticket_messages_ticket_id_created_at_idx" ON "support_ticket_messages"("ticket_id", "created_at");

ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
