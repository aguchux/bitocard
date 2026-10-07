-- BitoCard's own software licences are global: software is on sale in every market (admins can still switch it off
-- per market in Settings > Markets).
UPDATE "country_categories" SET "enabled" = true WHERE "category" = 'software';

-- Delivery emails: when the codes or licence keys of an order were emailed to the customer (recipient.email).
ALTER TABLE "orders" ADD COLUMN "delivery_emailed_at" TIMESTAMP(3);
