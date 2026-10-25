-- AlterTable
ALTER TABLE "classified_reports" ADD COLUMN     "conversation_id" UUID;

-- CreateTable
CREATE TABLE "classified_conversations" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "buyer_read_at" TIMESTAMP(3),
    "seller_read_at" TIMESTAMP(3),
    "buyer_alerted_at" TIMESTAMP(3),
    "seller_alerted_at" TIMESTAMP(3),
    "buyer_emailed_at" TIMESTAMP(3),
    "seller_emailed_at" TIMESTAMP(3),
    "buyer_blocked_at" TIMESTAMP(3),
    "seller_blocked_at" TIMESTAMP(3),
    "seller_replied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classified_messages" (
    "seq" BIGSERIAL NOT NULL,
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "offer_id" UUID,
    "object_key" TEXT,
    "content_type" TEXT,
    "size" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classified_offers" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "made_by_id" UUID NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classified_leads" (
    "listing_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "first_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_leads_pkey" PRIMARY KEY ("listing_id","buyer_id","kind")
);

-- CreateIndex
CREATE INDEX "classified_conversations_buyer_id_last_message_at_idx" ON "classified_conversations"("buyer_id", "last_message_at");

-- CreateIndex
CREATE INDEX "classified_conversations_seller_id_last_message_at_idx" ON "classified_conversations"("seller_id", "last_message_at");

-- CreateIndex
CREATE INDEX "classified_conversations_last_message_at_idx" ON "classified_conversations"("last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "classified_conversations_listing_id_buyer_id_key" ON "classified_conversations"("listing_id", "buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "classified_messages_seq_key" ON "classified_messages"("seq");

-- CreateIndex
CREATE INDEX "classified_messages_conversation_id_seq_idx" ON "classified_messages"("conversation_id", "seq");

-- CreateIndex
CREATE INDEX "classified_offers_conversation_id_created_at_idx" ON "classified_offers"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "classified_offers_status_expires_at_idx" ON "classified_offers"("status", "expires_at");

-- CreateIndex
CREATE INDEX "classified_leads_buyer_id_kind_first_at_idx" ON "classified_leads"("buyer_id", "kind", "first_at");

-- AddForeignKey
ALTER TABLE "classified_reports" ADD CONSTRAINT "classified_reports_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "classified_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_conversations" ADD CONSTRAINT "classified_conversations_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_conversations" ADD CONSTRAINT "classified_conversations_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_conversations" ADD CONSTRAINT "classified_conversations_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_messages" ADD CONSTRAINT "classified_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "classified_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_messages" ADD CONSTRAINT "classified_messages_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "classified_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_offers" ADD CONSTRAINT "classified_offers_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "classified_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_offers" ADD CONSTRAINT "classified_offers_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_leads" ADD CONSTRAINT "classified_leads_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classified_leads" ADD CONSTRAINT "classified_leads_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Checks the API relies on.
ALTER TABLE "classified_conversations" ADD CONSTRAINT "classified_conversations_sides_check" CHECK ("buyer_id" <> "seller_id");
ALTER TABLE "classified_messages" ADD CONSTRAINT "classified_messages_kind_check" CHECK ("kind" IN ('text', 'photo', 'offer', 'system'));
ALTER TABLE "classified_messages" ADD CONSTRAINT "classified_messages_photo_check" CHECK (("kind" = 'photo') = ("object_key" IS NOT NULL));
ALTER TABLE "classified_offers" ADD CONSTRAINT "classified_offers_status_check" CHECK ("status" IN ('open', 'accepted', 'declined', 'withdrawn', 'replaced', 'expired'));
ALTER TABLE "classified_offers" ADD CONSTRAINT "classified_offers_price_check" CHECK ("price_minor" > 0);
ALTER TABLE "classified_leads" ADD CONSTRAINT "classified_leads_kind_check" CHECK ("kind" IN ('phone', 'chat'));

-- One open offer per chat: a new one replaces it.
CREATE UNIQUE INDEX "classified_offers_open_key" ON "classified_offers"("conversation_id") WHERE "status" = 'open';
-- One open report per reporter and chat.
CREATE UNIQUE INDEX "classified_reports_open_chat_key" ON "classified_reports"("reporter_id", "conversation_id") WHERE "status" = 'open' AND "conversation_id" IS NOT NULL;
