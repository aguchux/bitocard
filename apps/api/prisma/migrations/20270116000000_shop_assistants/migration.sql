-- Shop assistants (Anjio): docs/BITOCARD_CLASSIFIEDS_PLAN.md, phase 1 step 10. Support bots gain the `shop` scope, with
-- languages, a greeting per language, limits, assignments to countries (and optionally languages) and the default
-- (Anjio, seeded as a draft), knowledge per country, conversation threads kept 30 days, and eval runs.

ALTER TABLE "support_bots" ADD COLUMN "shop_default" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "support_bots" ADD COLUMN "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "support_bots" ADD COLUMN "greetings" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "support_bots" ADD COLUMN "limits" JSONB NOT NULL DEFAULT '{}';

-- Exactly one default shop assistant.
CREATE UNIQUE INDEX "support_bots_shop_default_key" ON "support_bots"("shop_default") WHERE "shop_default";
ALTER TABLE "support_bots" ADD CONSTRAINT "support_bots_shop_default_check" CHECK (NOT "shop_default" OR "scope" = 'shop');
ALTER TABLE "support_bots" ADD CONSTRAINT "support_bots_shop_store_check" CHECK ("scope" <> 'shop' OR "store_id" IS NULL);

-- A version of a shop assistant's BitoCard sections for one country (null: the shared document, as for store assistants).
ALTER TABLE "support_bot_knowledge" ADD COLUMN "country" CHAR(2);
CREATE INDEX "support_bot_knowledge_bot_id_country_version_idx" ON "support_bot_knowledge"("bot_id", "country", "version");

-- CreateTable
CREATE TABLE "shop_bot_assignments" (
    "id" UUID NOT NULL,
    "bot_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "language" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_bot_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shop_bot_assignments_bot_id_country_language_key" ON "shop_bot_assignments"("bot_id", "country", COALESCE("language", ''));
-- At most one active assistant per country and language; "all its languages" (null) is its own slot.
CREATE UNIQUE INDEX "shop_bot_assignments_active_slot_key" ON "shop_bot_assignments"("country", COALESCE("language", '')) WHERE "active";
CREATE INDEX "shop_bot_assignments_country_idx" ON "shop_bot_assignments"("country");
ALTER TABLE "shop_bot_assignments" ADD CONSTRAINT "shop_bot_assignments_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "support_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shop_bot_assignments" ADD CONSTRAINT "shop_bot_assignments_country_check" CHECK ("country" ~ '^[A-Z]{2}$');
ALTER TABLE "shop_bot_assignments" ADD CONSTRAINT "shop_bot_assignments_language_check" CHECK ("language" IS NULL OR "language" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$');

-- CreateTable
CREATE TABLE "assistant_threads" (
    "id" UUID NOT NULL,
    "bot_id" UUID NOT NULL,
    "customer_id" UUID,
    "visitor_hash" CHAR(64),
    "country" CHAR(2) NOT NULL,
    "language" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "listing_id" UUID,
    "conversation_id" UUID,
    "chat_id" UUID,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_threads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assistant_threads_bot_id_last_message_at_idx" ON "assistant_threads"("bot_id", "last_message_at");
CREATE INDEX "assistant_threads_customer_id_idx" ON "assistant_threads"("customer_id");
CREATE INDEX "assistant_threads_visitor_hash_idx" ON "assistant_threads"("visitor_hash");
CREATE INDEX "assistant_threads_last_message_at_idx" ON "assistant_threads"("last_message_at");
ALTER TABLE "assistant_threads" ADD CONSTRAINT "assistant_threads_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "support_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assistant_threads" ADD CONSTRAINT "assistant_threads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assistant_threads" ADD CONSTRAINT "assistant_threads_owner_check" CHECK (("customer_id" IS NULL) <> ("visitor_hash" IS NULL));
ALTER TABLE "assistant_threads" ADD CONSTRAINT "assistant_threads_surface_check" CHECK ("surface" IN ('browse', 'sell', 'help'));

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cards" JSONB NOT NULL DEFAULT '[]',
    "tool_calls" JSONB NOT NULL DEFAULT '[]',
    "rating" SMALLINT,
    "reported_at" TIMESTAMP(3),
    "report_reason" TEXT,
    "address_hash" CHAR(64),
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assistant_messages_thread_id_created_at_idx" ON "assistant_messages"("thread_id", "created_at");
CREATE INDEX "assistant_messages_address_hash_created_at_idx" ON "assistant_messages"("address_hash", "created_at");
CREATE INDEX "assistant_messages_reported_at_idx" ON "assistant_messages"("reported_at");
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "assistant_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_role_check" CHECK ("role" IN ('user', 'assistant'));
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_rating_check" CHECK ("rating" IS NULL OR "rating" IN (-1, 1));

-- CreateTable
CREATE TABLE "shop_bot_evals" (
    "id" UUID NOT NULL,
    "bot_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "cases" INTEGER NOT NULL,
    "passed" INTEGER NOT NULL,
    "results" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_bot_evals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shop_bot_evals_bot_id_created_at_idx" ON "shop_bot_evals"("bot_id", "created_at");
ALTER TABLE "shop_bot_evals" ADD CONSTRAINT "shop_bot_evals_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "support_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Anjio, the default in every country: a draft for an admin to choose its model, check its knowledge and activate.
INSERT INTO "support_bots" ("id", "reseller_id", "scope", "roles", "provider", "model", "funding", "name", "greeting", "tone", "status", "shop_default", "languages", "greetings", "limits", "updated_at")
VALUES (
  '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 'shop', ARRAY['browse', 'sell', 'help'], 'anthropic', 'claude-sonnet-5-5', 'bitocard',
  'Anjio', 'Hi, I''m Anjio. What are you looking for?', 'friendly', 'draft', true, ARRAY['en'],
  '{"en": "Hi, I''m Anjio. What are you looking for?"}', '{"customer_daily": 50, "visitor_daily": 10, "photos_per_draft": 8, "monthly_budget_usd": null}', CURRENT_TIMESTAMP
);
