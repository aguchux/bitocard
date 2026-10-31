import type { Metadata } from "next";
import { ListingForm } from "@/components/account/listing-form";
import { requireSeller, sellerAssistant, sellReference, resaleAvailability } from "@/lib/account";

export const metadata: Metadata = { title: "Post an ad" };

/** Post an ad: nothing is made until the seller's first change, then the draft carries on at `/account/listings/<id>`. */
export default async function PostAd() {
  const { customer, market } = await requireSeller("/sell");
  const [{ categories, states }, assistant, resale] = await Promise.all([sellReference(market.country), sellerAssistant(market.country), resaleAvailability()]);
  return <ListingForm listing={null} categories={categories} states={states} currency={market.currency} country={market.country} phoneConfirmed={customer.phone_verified} minPhotos={4} assistant={assistant} resale={resale} />;
}
