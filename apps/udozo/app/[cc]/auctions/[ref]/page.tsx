import { notFound, permanentRedirect } from "next/navigation";
import { listingPath } from "@bitocard/api-client/classifieds";
import { shopApi } from "@/lib/api";

type Props = { params: Promise<{ cc: string; ref: string }> };

/** A lot's old address: every lot is now an auction listing, bid on from the listing's own page. */
export default async function LotPage({ params }: Props) {
  const { ref } = await params;
  if (!/^\d{1,9}$/.test(ref)) notFound();
  const result = await shopApi<{ country: string; listing: { ref: number; slug: string } | null }>(`/v1/classifieds/auctions/${ref}`);
  if (!result.ok || !result.data.listing) notFound();
  permanentRedirect(listingPath(result.data.country, result.data.listing.ref, result.data.listing.slug));
}
