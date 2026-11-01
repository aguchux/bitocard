import { conditionLabels, listingRef, type ShopListingPage } from "@bitocard/api-client/classifieds";
import { ogImageSize } from "@bitocard/ui/og-image";
import { shopApi } from "@/lib/api";
import { listingCard, ogMoney, ogPhoto, textCard } from "@/lib/og";

export const alt = "A listing on Udozo, with its photo, price and area";
export const size = ogImageSize;
export const contentType = "image/png";

/** A listing's social preview: its cover photo, title, price, area and condition; Udozo's card if it is gone. */
export default async function ListingImage({ params }: { params: Promise<{ cc: string; listing: string }> }) {
  const { cc, listing: segment } = await params;
  const ref = listingRef(segment);
  const result = ref ? await shopApi<ShopListingPage>(`/v1/classifieds/listings/${ref}?country=${cc.toUpperCase()}`) : null;
  if (!result?.ok) return textCard({ eyebrow: "Udozo", title: "Buy and sell near you", line: "Chat with sellers and pay with Safe pay." });
  const listing = result.data;
  const price = listing.price.kind === "on_request" || listing.price.amount === null ? "Price on request" : ogMoney(listing.price.amount, listing.price.currency);
  return listingCard({
    title: listing.title,
    price,
    place: `${listing.area.name}, ${listing.area.state.name}`,
    category: listing.category.name,
    condition: listing.condition ? conditionLabels[listing.condition] : null,
    sold: listing.status === "sold",
    photo: await ogPhoto(listing.photos[0]?.url),
  });
}
