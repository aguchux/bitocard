-- Assistants answering: which assistant a chat is with, claims so one run answers at a time, and ticket reply drafts.
ALTER TABLE "support_conversations" ADD COLUMN "bot_id" UUID, ADD COLUMN "bot_claimed_at" TIMESTAMP(3);
ALTER TABLE "support_tickets" ADD COLUMN "bot_claimed_at" TIMESTAMP(3);
ALTER TABLE "support_ticket_messages" ADD COLUMN "draft" BOOLEAN NOT NULL DEFAULT false;
