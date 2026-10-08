-- The customer account app's menu on desktop, per store (null follows BitoCard's switch).
ALTER TABLE "stores" ADD COLUMN     "desktop_nav" TEXT;
