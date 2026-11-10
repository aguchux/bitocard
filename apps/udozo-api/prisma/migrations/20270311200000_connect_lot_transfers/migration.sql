-- A Udozo auction lot sent from Udozo's warehouse to a Connect Centre near its buyer, held there until they collect it.
ALTER TABLE "classified_orders" DROP CONSTRAINT "classified_orders_connect_place_check";
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_connect_place_check" CHECK ("connect_place" IS NULL OR "connect_place" IN ('awaiting_pickup', 'in_transit', 'udozo_warehouse', 'auctioned', 'lot_at_centre'));
