-- WhatsApp direct contact (7 November 2026, the owner's request): a seller may choose "Let buyers WhatsApp me
-- directly" (Profile > WhatsApp on udozo.com, off by default); Contact seller on Udozo's WhatsApp then gives a signed-in
-- buyer the seller's connected WhatsApp number and a wa.me link about the listing. Each buyer and listing is recorded
-- once (the buyer's daily limit, and the seller is told who has it), kept 12 months.
ALTER TABLE "whatsapp_contacts" ADD COLUMN "direct_at" TIMESTAMP(3);

CREATE TABLE "whatsapp_direct_contacts" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_direct_contacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_direct_contacts_buyer_id_listing_id_key" ON "whatsapp_direct_contacts"("buyer_id", "listing_id");
CREATE INDEX "whatsapp_direct_contacts_buyer_id_created_at_idx" ON "whatsapp_direct_contacts"("buyer_id", "created_at");
CREATE INDEX "whatsapp_direct_contacts_seller_id_idx" ON "whatsapp_direct_contacts"("seller_id");

ALTER TABLE "whatsapp_direct_contacts" ADD CONSTRAINT "whatsapp_direct_contacts_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_direct_contacts" ADD CONSTRAINT "whatsapp_direct_contacts_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_direct_contacts" ADD CONSTRAINT "whatsapp_direct_contacts_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
