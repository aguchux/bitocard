-- Udozo on WhatsApp (docs/UDOZO_WHATSAPP_PLAN.md): Udozo's own WhatsApp Business number, through Meta's Cloud API.
-- A number is tied to at most one Udozo customer; messages in and out are kept 90 days; inbound webhook bodies are
-- stored encrypted before Meta is answered, then processed (and retried) from the table.
CREATE TABLE "whatsapp_contacts" (
    "id" UUID NOT NULL,
    "wa_id" VARCHAR(20) NOT NULL,
    "customer_id" UUID,
    "country" CHAR(2),
    "profile_name" TEXT,
    "linked_at" TIMESTAMP(3),
    "opted_in_at" TIMESTAMP(3),
    "opted_out_at" TIMESTAMP(3),
    "last_inbound_at" TIMESTAMP(3),
    "chats_on" BOOLEAN NOT NULL DEFAULT true,
    "alerts_on" BOOLEAN NOT NULL DEFAULT true,
    "unreachable_at" TIMESTAMP(3),
    "flow" TEXT,
    "flow_state" JSONB,
    "flow_updated_at" TIMESTAMP(3),
    "active_conversation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "whatsapp_contacts_wa_id_key" ON "whatsapp_contacts"("wa_id");
CREATE UNIQUE INDEX "whatsapp_contacts_customer_id_key" ON "whatsapp_contacts"("customer_id");
CREATE INDEX "whatsapp_contacts_flow_updated_at_idx" ON "whatsapp_contacts"("flow_updated_at");
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_active_conversation_id_fkey" FOREIGN KEY ("active_conversation_id") REFERENCES "classified_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Profile > WhatsApp on udozo.com: a one-time code sent from the number (`LINK <code>`) ties it to the account.
CREATE TABLE "whatsapp_link_codes" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_link_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "whatsapp_link_codes_code_hash_key" ON "whatsapp_link_codes"("code_hash");
CREATE INDEX "whatsapp_link_codes_customer_id_idx" ON "whatsapp_link_codes"("customer_id");
ALTER TABLE "whatsapp_link_codes" ADD CONSTRAINT "whatsapp_link_codes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "whatsapp_notices" (
    "id" UUID NOT NULL,
    "body_hash" TEXT NOT NULL,
    "body_encrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "whatsapp_notices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "whatsapp_notices_status" CHECK ("status" IN ('received', 'processed', 'failed'))
);
CREATE UNIQUE INDEX "whatsapp_notices_body_hash_key" ON "whatsapp_notices"("body_hash");
CREATE INDEX "whatsapp_notices_status_next_attempt_at_idx" ON "whatsapp_notices"("status", "next_attempt_at");

CREATE TABLE "whatsapp_messages" (
    "id" UUID NOT NULL,
    "wamid" TEXT,
    "contact_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "template" TEXT,
    "conversation_id" UUID,
    "classified_message_id" UUID,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "payload_encrypted" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "whatsapp_messages_direction" CHECK ("direction" IN ('in', 'out')),
    CONSTRAINT "whatsapp_messages_status" CHECK ("status" IN ('received', 'queued', 'sent', 'delivered', 'read', 'failed'))
);
CREATE UNIQUE INDEX "whatsapp_messages_wamid_key" ON "whatsapp_messages"("wamid");
CREATE INDEX "whatsapp_messages_contact_id_created_at_idx" ON "whatsapp_messages"("contact_id", "created_at");
CREATE INDEX "whatsapp_messages_status_next_attempt_at_idx" ON "whatsapp_messages"("status", "next_attempt_at");
CREATE INDEX "whatsapp_messages_created_at_idx" ON "whatsapp_messages"("created_at");
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "classified_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_classified_message_id_fkey" FOREIGN KEY ("classified_message_id") REFERENCES "classified_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A chat message written from WhatsApp is shown "via WhatsApp".
ALTER TABLE "classified_messages" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'web';
ALTER TABLE "classified_messages" ADD CONSTRAINT "classified_messages_channel_check" CHECK ("channel" IN ('web', 'whatsapp'));

-- Each notice type can also be sent on WhatsApp (null: its default).
ALTER TABLE "notification_preferences" ADD COLUMN "whatsapp" BOOLEAN;

-- Wanted requests: a buyer says what they need, matching listings are shown and sellers in that category and place told.
CREATE TABLE "classified_wanted_requests" (
    "id" UUID NOT NULL,
    "number" BIGSERIAL NOT NULL,
    "customer_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "category_id" UUID NOT NULL,
    "state_id" UUID,
    "area_id" UUID,
    "words" VARCHAR(80) NOT NULL,
    "details" VARCHAR(300),
    "budget_min_minor" BIGINT,
    "budget_max_minor" BIGINT,
    "conditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'open',
    "source" TEXT NOT NULL DEFAULT 'web',
    "sellers_told" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "removed_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classified_wanted_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classified_wanted_requests_status" CHECK ("status" IN ('open', 'fulfilled', 'closed', 'expired', 'removed')),
    CONSTRAINT "classified_wanted_requests_source" CHECK ("source" IN ('web', 'whatsapp')),
    CONSTRAINT "classified_wanted_requests_budget" CHECK (("budget_min_minor" IS NULL OR "budget_min_minor" >= 0) AND ("budget_max_minor" IS NULL OR "budget_max_minor" > 0) AND ("budget_min_minor" IS NULL OR "budget_max_minor" IS NULL OR "budget_min_minor" <= "budget_max_minor"))
);
CREATE UNIQUE INDEX "classified_wanted_requests_number_key" ON "classified_wanted_requests"("number");
CREATE INDEX "classified_wanted_requests_customer_id_created_at_idx" ON "classified_wanted_requests"("customer_id", "created_at");
CREATE INDEX "classified_wanted_requests_status_expires_at_idx" ON "classified_wanted_requests"("status", "expires_at");
CREATE INDEX "classified_wanted_requests_country_status_idx" ON "classified_wanted_requests"("country", "status");
ALTER TABLE "classified_wanted_requests" ADD CONSTRAINT "classified_wanted_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_wanted_requests" ADD CONSTRAINT "classified_wanted_requests_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "classified_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "classified_wanted_requests" ADD CONSTRAINT "classified_wanted_requests_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "classified_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "classified_wanted_requests" ADD CONSTRAINT "classified_wanted_requests_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "classified_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Each seller is told about a request once.
CREATE TABLE "classified_wanted_matches" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "notified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_wanted_matches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "classified_wanted_matches_request_id_seller_id_key" ON "classified_wanted_matches"("request_id", "seller_id");
CREATE INDEX "classified_wanted_matches_seller_id_notified_at_idx" ON "classified_wanted_matches"("seller_id", "notified_at");
ALTER TABLE "classified_wanted_matches" ADD CONSTRAINT "classified_wanted_matches_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "classified_wanted_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_wanted_matches" ADD CONSTRAINT "classified_wanted_matches_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A seller's answer: one of their live listings, which opens (or joins) that listing's chat with the buyer.
CREATE TABLE "classified_wanted_responses" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "conversation_id" UUID,
    "note" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_wanted_responses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "classified_wanted_responses_request_id_seller_id_key" ON "classified_wanted_responses"("request_id", "seller_id");
CREATE INDEX "classified_wanted_responses_seller_id_idx" ON "classified_wanted_responses"("seller_id");
ALTER TABLE "classified_wanted_responses" ADD CONSTRAINT "classified_wanted_responses_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "classified_wanted_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_wanted_responses" ADD CONSTRAINT "classified_wanted_responses_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_wanted_responses" ADD CONSTRAINT "classified_wanted_responses_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_wanted_responses" ADD CONSTRAINT "classified_wanted_responses_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "classified_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Each market's limits on wanted requests.
ALTER TABLE "classified_market_settings" ADD COLUMN "wanted_open_per_buyer" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "classified_market_settings" ADD COLUMN "wanted_per_day" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "classified_market_settings" ADD COLUMN "wanted_sellers_per_request" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "classified_market_settings" ADD COLUMN "wanted_notices_per_seller_day" INTEGER NOT NULL DEFAULT 20;
