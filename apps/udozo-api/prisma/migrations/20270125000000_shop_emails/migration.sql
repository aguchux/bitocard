-- B2B reselling stage 6 (docs/BITOCARD_B2B_RESELLING_PLAN.md): Safe pay orders, resale relationships and BitoCard Shop
-- notices are emailed as well as sent to the inbox. New messages are emailed at most every 10 minutes per order (or
-- supplier and reseller) and person, claimed on the *_emailed_at columns; each deadline reminder is sent once, claimed
-- on its *_reminded_at column.
ALTER TABLE "classified_orders" ADD COLUMN "buyer_emailed_at" TIMESTAMP(3);
ALTER TABLE "classified_orders" ADD COLUMN "supplier_emailed_at" TIMESTAMP(3);
ALTER TABLE "classified_orders" ADD COLUMN "reseller_emailed_at" TIMESTAMP(3);
ALTER TABLE "classified_orders" ADD COLUMN "accept_reminded_at" TIMESTAMP(3);
ALTER TABLE "classified_orders" ADD COLUMN "pay_reminded_at" TIMESTAMP(3);
ALTER TABLE "classified_orders" ADD COLUMN "handover_reminded_at" TIMESTAMP(3);
ALTER TABLE "classified_orders" ADD COLUMN "confirm_reminded_at" TIMESTAMP(3);
ALTER TABLE "resale_relationships" ADD COLUMN "supplier_emailed_at" TIMESTAMP(3);
ALTER TABLE "resale_relationships" ADD COLUMN "reseller_emailed_at" TIMESTAMP(3);
