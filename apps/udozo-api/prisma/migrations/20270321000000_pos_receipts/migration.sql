-- Udozo POS milestone 6 (docs/UDOZO_POS_PLAN.md): receipts. Every sale prints as an 80 mm or 58 mm receipt or an A4
-- invoice, and goes to the customer as a PDF on WhatsApp (by the receipt's QR code, or to a number the cashier types)
-- or by email. PDFs are drawn when asked for, never stored.

-- The shop's details receipts and invoices carry: its email, its own bank account for later payments (shown, never used
-- by Udozo), whether receipts print the WhatsApp QR code, and the next invoice's number.
ALTER TABLE "pos_shops"
  ADD COLUMN "email" VARCHAR(254),
  ADD COLUMN "bank_name" VARCHAR(80),
  ADD COLUMN "bank_account_name" VARCHAR(120),
  ADD COLUMN "bank_account_number" VARCHAR(30),
  ADD COLUMN "receipt_qr" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "invoice_next" INTEGER NOT NULL DEFAULT 1;

-- A sale's invoice number (INV-2026-0148), given the first time its invoice is drawn, then always the same.
ALTER TABLE "pos_sales"
  ADD COLUMN "invoice_number" VARCHAR(20),
  ADD COLUMN "invoice_issued_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "pos_sales_shop_invoice_key" ON "pos_sales" ("shop_id", "invoice_number");

-- A receipt's code: the customer sends "RECEIPT POS-000123-<code>" to Udozo's WhatsApp number (the QR code fills it in,
-- or the template's button sends it back) and gets the PDF. Only the code's hash is kept. `purpose`: `screen` (shown at
-- the till, 10 minutes), `print` (on a printed receipt, 30 days) or `whatsapp` (sent to a number, 7 days).
CREATE TABLE "pos_receipt_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "sale_id" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL DEFAULT 'receipt',
  "purpose" VARCHAR(16) NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "used_count" INTEGER NOT NULL DEFAULT 0,
  "delivered_to" VARCHAR(40),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_receipt_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_receipt_codes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_receipt_codes_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_receipt_codes_kind_check" CHECK ("kind" IN ('receipt', 'invoice')),
  CONSTRAINT "pos_receipt_codes_purpose_check" CHECK ("purpose" IN ('screen', 'print', 'whatsapp'))
);
CREATE UNIQUE INDEX "pos_receipt_codes_token_key" ON "pos_receipt_codes" ("token_hash");
CREATE INDEX "pos_receipt_codes_sale_idx" ON "pos_receipt_codes" ("sale_id", "created_at" DESC);

-- Every receipt sent: on WhatsApp (to a number, or to whoever scanned its code) or by email, with where it went (a
-- masked number or email, never in full), who sent it and how it went.
CREATE TABLE "pos_receipt_sends" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "sale_id" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "via" VARCHAR(16) NOT NULL,
  "to_hint" VARCHAR(80) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "error" VARCHAR(300),
  "whatsapp_message_id" UUID,
  "by_name" VARCHAR(120),
  "by_staff_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_receipt_sends_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_receipt_sends_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "pos_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_receipt_sends_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pos_receipt_sends_kind_check" CHECK ("kind" IN ('receipt', 'invoice', 'both')),
  CONSTRAINT "pos_receipt_sends_via_check" CHECK ("via" IN ('whatsapp', 'email', 'qr')),
  CONSTRAINT "pos_receipt_sends_status_check" CHECK ("status" IN ('queued', 'sent', 'failed'))
);
CREATE INDEX "pos_receipt_sends_sale_idx" ON "pos_receipt_sends" ("sale_id", "created_at" DESC);
CREATE INDEX "pos_receipt_sends_account_idx" ON "pos_receipt_sends" ("account_id", "created_at" DESC);
