-- Afrippa's escrow engine, step 3 item 5 (docs/CRYPTO_SPINOFF_PLAN.md): the order room. One chat per order between the
-- buyer and the seller, with Afrippa's team writing in it during an appeal and a line from the system at every step;
-- receipts and evidence as photos and PDFs, sealed in Afrippa's private bucket. And the deadline reminders: the buyer
-- before the window ends, the seller once it is paid and not released.
CREATE TABLE "p2p_order_messages" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "author" TEXT NOT NULL,
    "author_id" UUID,
    "body" TEXT,
    "file_name" TEXT,
    "file_type" TEXT,
    "file_size" INTEGER,
    "file_width" INTEGER,
    "file_height" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "p2p_order_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "p2p_order_messages_author" CHECK ("author" IN ('buyer', 'seller', 'afrippa', 'system')),
    CONSTRAINT "p2p_order_messages_content" CHECK ("body" IS NOT NULL OR "file_name" IS NOT NULL)
);
CREATE INDEX "p2p_order_messages_order_id_created_at_idx" ON "p2p_order_messages"("order_id", "created_at");
ALTER TABLE "p2p_order_messages" ADD CONSTRAINT "p2p_order_messages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "p2p_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "p2p_orders" ADD COLUMN "pay_reminded_at" TIMESTAMP(3);
ALTER TABLE "p2p_orders" ADD COLUMN "release_reminded_at" TIMESTAMP(3);
