import type { Metadata } from "next";
import { ListingForm } from "@/components/account/listing-form";
import { SellVisit } from "@/components/account/sell-visit";
import { posStatus, requireSeller, sellerAssistant, sellReference, resaleAvailability, shopCategories } from "@/lib/account";
import { connectShippingFor } from "@/lib/connect-centres";
import { cleanSellSource, sellHref } from "@/lib/sell-sources";

export const metadata: Metadata = { title: "Post an ad" };

/**
 * Post an ad: nothing is made until the seller's first change, then the draft carries on at `/account/listings/<id>`.
 * Where Sell was pressed (`?from=`) goes with the seller through sign-in and confirming their email, for their posting
 * journey in Udozo's admin.
 */
export default async function PostAd({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const source = cleanSellSource((await searchParams).from);
  const { customer, market } = await requireSeller(sellHref(source));
  const [{ categories, states }, assistant, resale, connect, pos, shopOnly] = await Promise.all([sellReference(market.country), sellerAssistant(market.country), resaleAvailability(), connectShippingFor(market), posStatus(), shopCategories()]);
  return (
    <>
      <SellVisit source={source} signedIn />
      <ListingForm listing={null} categories={[...categories, ...shopOnly]} states={states} currency={market.currency} country={market.country} phoneConfirmed={customer.phone_verified} minPhotos={market.min_photos ?? 4} assistant={assistant} resale={resale} pos={pos} source={source} connect={connect} auctions={Boolean(market.auctions)} />
    </>
  );
}
