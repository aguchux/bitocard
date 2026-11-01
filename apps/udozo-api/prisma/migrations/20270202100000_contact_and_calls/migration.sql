-- Getting in touch with a seller without their details being shown to everyone: buyers request the seller's contact
-- details (shown to them on every listing of the seller's once accepted) or a call back (the buyer's name, mobile and
-- email go to the seller), and call the seller in the browser while both are on udozo.com, relayed so neither side
-- sees the other's number or address. Show phone is gone.

-- CreateTable
CREATE TABLE "classified_contact_requests" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "listing_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "answered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_contact_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classified_contact_requests_kind_check" CHECK ("kind" IN ('contact', 'callback')),
    CONSTRAINT "classified_contact_requests_status_check" CHECK ("status" IN ('pending', 'accepted', 'declined', 'done', 'dismissed', 'cancelled'))
);

-- CreateTable
CREATE TABLE "classified_contact_shares" (
    "seller_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_contact_shares_pkey" PRIMARY KEY ("seller_id","buyer_id")
);

-- CreateTable
CREATE TABLE "classified_calls" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "caller_id" UUID NOT NULL,
    "callee_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ringing',
    "caller_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "callee_seen_at" TIMESTAMP(3),
    "answered_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "ended_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_calls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classified_calls_status_check" CHECK ("status" IN ('ringing', 'answered', 'ended', 'missed', 'declined', 'cancelled', 'lost')),
    CONSTRAINT "classified_calls_parties_check" CHECK ("caller_id" <> "callee_id")
);

-- CreateTable
CREATE TABLE "classified_call_signals" (
    "id" BIGSERIAL NOT NULL,
    "call_id" UUID NOT NULL,
    "from_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classified_call_signals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classified_call_signals_kind_check" CHECK ("kind" IN ('offer', 'answer', 'candidate'))
);

-- CreateTable
CREATE TABLE "customer_presence" (
    "customer_id" UUID NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_presence_pkey" PRIMARY KEY ("customer_id")
);

-- CreateIndex
CREATE INDEX "classified_contact_requests_seller_id_status_created_at_idx" ON "classified_contact_requests"("seller_id", "status", "created_at");
CREATE INDEX "classified_contact_requests_buyer_id_kind_created_at_idx" ON "classified_contact_requests"("buyer_id", "kind", "created_at");
-- One open contact request per buyer and seller, and one open call back per buyer and listing.
CREATE UNIQUE INDEX "classified_contact_requests_open_contact" ON "classified_contact_requests"("seller_id", "buyer_id") WHERE "kind" = 'contact' AND "status" = 'pending';
CREATE UNIQUE INDEX "classified_contact_requests_open_callback" ON "classified_contact_requests"("listing_id", "buyer_id") WHERE "kind" = 'callback' AND "status" = 'pending';
CREATE INDEX "classified_contact_shares_buyer_id_idx" ON "classified_contact_shares"("buyer_id");
CREATE INDEX "classified_calls_callee_id_status_idx" ON "classified_calls"("callee_id", "status");
CREATE INDEX "classified_calls_caller_id_status_idx" ON "classified_calls"("caller_id", "status");
CREATE INDEX "classified_calls_created_at_idx" ON "classified_calls"("created_at");
-- A person rings or takes one call at a time.
CREATE UNIQUE INDEX "classified_calls_live_caller" ON "classified_calls"("caller_id") WHERE "status" IN ('ringing', 'answered');
CREATE UNIQUE INDEX "classified_calls_live_callee" ON "classified_calls"("callee_id") WHERE "status" IN ('ringing', 'answered');
CREATE INDEX "classified_call_signals_call_id_id_idx" ON "classified_call_signals"("call_id", "id");

-- AddForeignKey
ALTER TABLE "classified_contact_requests" ADD CONSTRAINT "classified_contact_requests_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_contact_requests" ADD CONSTRAINT "classified_contact_requests_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_contact_requests" ADD CONSTRAINT "classified_contact_requests_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_contact_shares" ADD CONSTRAINT "classified_contact_shares_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_contact_shares" ADD CONSTRAINT "classified_contact_shares_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_calls" ADD CONSTRAINT "classified_calls_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_calls" ADD CONSTRAINT "classified_calls_caller_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_calls" ADD CONSTRAINT "classified_calls_callee_id_fkey" FOREIGN KEY ("callee_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_call_signals" ADD CONSTRAINT "classified_call_signals_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "classified_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_presence" ADD CONSTRAINT "customer_presence_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
