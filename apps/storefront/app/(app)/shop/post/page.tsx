import type { Metadata } from "next";
import { ListingForm } from "@/components/app/shop/listing-form";
import { requireShop, shopReference } from "@/lib/shop-server";

export const metadata: Metadata = { title: "Post an ad" };

/** Post an ad: nothing is made until the seller's first change, then the draft carries on at `/shop/listings/<id>`. */
export default async function PostAd() {
  const { customer, market } = await requireShop("/shop/post");
  const { categories, states } = await shopReference(market.country);
  return <ListingForm listing={null} categories={categories} states={states} currency={market.currency} phoneConfirmed={customer.phone_verified} minPhotos={4} />;
}
