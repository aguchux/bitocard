-- Anjio on WhatsApp: a conversation with the shop assistant is held on udozo.com (web) or on Udozo's WhatsApp number,
-- and each WhatsApp number keeps its current one.
ALTER TABLE "assistant_threads" ADD COLUMN "channel" VARCHAR(10) NOT NULL DEFAULT 'web';

ALTER TABLE "whatsapp_contacts" ADD COLUMN "assistant_thread_id" UUID;
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_assistant_thread_id_fkey" FOREIGN KEY ("assistant_thread_id") REFERENCES "assistant_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
