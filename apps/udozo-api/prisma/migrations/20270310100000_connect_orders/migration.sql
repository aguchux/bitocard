-- Udozo Connect, phase 5 (docs/UDOZO_CONNECT_PLAN.md): UdozoPay orders collected at a Connect Centre. The seller sends the
-- item there, the centre receives and shelves it, and hands it over against the buyer's release code; the buyer pays the
-- shipping charge for the centre's state and a Connect fee, shared between the centre and Udozo.
-- AlterEnum
ALTER TYPE "AccountKind" ADD VALUE 'connect_revenue';
ALTER TYPE "AccountKind" ADD VALUE 'connect_centre_earnings';

ALTER TABLE "connect_settings" ADD COLUMN "fee_kind" TEXT,
ADD COLUMN "fee_bps" INTEGER,
ADD COLUMN "fee_minor" BIGINT,
ADD COLUMN "centre_share_bps" INTEGER NOT NULL DEFAULT 7000,
ADD COLUMN "buyer_free_hours" INTEGER NOT NULL DEFAULT 72;
ALTER TABLE "connect_settings" ADD CONSTRAINT "connect_settings_fee_check" CHECK (
  ("fee_kind" IS NULL) OR ("fee_kind" = 'percent' AND "fee_bps" BETWEEN 0 AND 10000) OR ("fee_kind" = 'fixed' AND "fee_minor" >= 0)
);
ALTER TABLE "connect_settings" ADD CONSTRAINT "connect_settings_share_check" CHECK ("centre_share_bps" BETWEEN 0 AND 10000 AND "buyer_free_hours" BETWEEN 1 AND 720);

ALTER TABLE "classified_orders" ADD COLUMN "connect_centre_id" UUID,
ADD COLUMN "connect_fee_minor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "centre_share_minor" BIGINT,
ADD COLUMN "received_at" TIMESTAMP(3),
ADD COLUMN "connect_shelf_id" UUID,
ADD COLUMN "ready_at" TIMESTAMP(3),
ADD COLUMN "collect_by" TIMESTAMP(3),
ADD COLUMN "released_by_id" UUID;

ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_connect_centre_id_fkey" FOREIGN KEY ("connect_centre_id") REFERENCES "connect_centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_connect_shelf_id_fkey" FOREIGN KEY ("connect_shelf_id") REFERENCES "connect_shelves"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "classified_orders_connect_centre_id_status_idx" ON "classified_orders"("connect_centre_id", "status");

-- A third way to hand an item over, and its own statuses: at the centre (received, then shelved and ready).
ALTER TABLE "classified_orders" DROP CONSTRAINT "classified_orders_fulfilment_check";
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_fulfilment_check" CHECK ("fulfilment" IN ('meet_up', 'delivery', 'connect'));
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_connect_check" CHECK (("fulfilment" = 'connect') = ("connect_centre_id" IS NOT NULL) AND "connect_fee_minor" >= 0);
ALTER TABLE "classified_orders" DROP CONSTRAINT "classified_orders_status_check";
ALTER TABLE "classified_orders" ADD CONSTRAINT "classified_orders_status_check" CHECK ("status" IN ('requested', 'declined', 'lapsed', 'awaiting_payment', 'cancelled', 'locked', 'paid', 'sent', 'at_centre', 'disputed', 'released', 'refunded', 'partly_refunded'));

-- A centre reports its own steps on the order's timeline.
ALTER TABLE "classified_shipment_events" DROP CONSTRAINT "classified_shipment_events_status_check";
ALTER TABLE "classified_shipment_events" ADD CONSTRAINT "classified_shipment_events_status_check" CHECK ("status" IN ('shipped', 'in_transit', 'out_for_delivery', 'delivered', 'failed_attempt', 'returned', 'received', 'refused', 'ready', 'collected', 'collection_refused', 'note'));
ALTER TABLE "classified_shipment_events" DROP CONSTRAINT "classified_shipment_events_reported_by_check";
ALTER TABLE "classified_shipment_events" ADD CONSTRAINT "classified_shipment_events_reported_by_check" CHECK ("reported_by" IN ('seller', 'courier', 'bitocard', 'centre'));
