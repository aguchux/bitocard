-- Udozo Connect, phase 4 (docs/UDOZO_CONNECT_PLAN.md): listings shipped through Udozo Connect, to a Connect Centre in the
-- states the seller ticks, at the seller's own charge per state, through every active centre there or those chosen.
ALTER TABLE "classified_listings" ADD COLUMN "connect" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "connect_all_centres" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "classified_listing_connect_states" (
    "listing_id" UUID NOT NULL,
    "state_id" UUID NOT NULL,
    "shipping_minor" BIGINT NOT NULL,

    CONSTRAINT "classified_listing_connect_states_pkey" PRIMARY KEY ("listing_id","state_id"),
    CONSTRAINT "classified_listing_connect_states_shipping_check" CHECK ("shipping_minor" >= 0)
);

CREATE TABLE "classified_listing_connect_centres" (
    "listing_id" UUID NOT NULL,
    "centre_id" UUID NOT NULL,

    CONSTRAINT "classified_listing_connect_centres_pkey" PRIMARY KEY ("listing_id","centre_id")
);

CREATE INDEX "classified_listing_connect_states_state_id_idx" ON "classified_listing_connect_states"("state_id");
CREATE INDEX "classified_listing_connect_centres_centre_id_idx" ON "classified_listing_connect_centres"("centre_id");

ALTER TABLE "classified_listing_connect_states" ADD CONSTRAINT "classified_listing_connect_states_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_listing_connect_states" ADD CONSTRAINT "classified_listing_connect_states_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "classified_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_listing_connect_centres" ADD CONSTRAINT "classified_listing_connect_centres_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "classified_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classified_listing_connect_centres" ADD CONSTRAINT "classified_listing_connect_centres_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "connect_centres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A listing is handed over somehow: in person, by delivery, or through a Connect Centre.
ALTER TABLE "classified_listings" DROP CONSTRAINT "classified_listings_fulfilment_check";
ALTER TABLE "classified_listings" ADD CONSTRAINT "classified_listings_fulfilment_check" CHECK ("pickup" OR "delivery" <> 'none' OR "connect");
