import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ShopListingStats, ShopMyListing } from "@bitocard/api-client/classifieds";
import { ListingForm } from "@/components/account/listing-form";
import { customerApi } from "@/lib/customer";
import { uuidPattern } from "@/lib/shop";
import { requireSeller, sellerAssistant, listingHref, sellReference, resaleAvailability } from "@/lib/account";

export const metadata: Metadata = { title: "Your ad" };

type Props = { params: Promise<{ id: string }> };

/** One of the seller's listings: its figures, then the same form as Post an ad (a draft carries on where it was left). */
export default async function ListingPage({ params }: Props) {
  const { id } = await params;
  const { customer, market } = await requireSeller(`/account/listings/${id}`);
  if (!uuidPattern.test(id)) notFound();
  const [listing, stats, reference, assistant, resale] = await Promise.all([
    customerApi<ShopMyListing>("GET", `/v1/classifieds/me/listings/${id}`),
    customerApi<ShopListingStats>("GET", `/v1/classifieds/me/listings/${id}/stats`),
    sellReference(market.country),
    sellerAssistant(market.country),
    resaleAvailability(),
  ]);
  if (!listing.ok) notFound();
  const closed = ["sold", "expired", "removed"].includes(listing.data.status);
  const publicHref = listingHref(listing.data.url);
  const figures = stats.ok && listing.data.status !== "draft" ? [
    { label: "Views", value: stats.data.views },
    { label: "Leads", value: stats.data.leads },
    { label: "Chats", value: stats.data.chats },
    { label: "Phone shown", value: stats.data.phone_reveals },
    { label: "Offers", value: stats.data.offers },
  ] : null;
  return (
    <div className="grid gap-5">
      {figures ? (
        <section aria-label="How it is doing" className="grid gap-2">
          <ul className="grid grid-cols-5 gap-2 sm:max-w-2xl">
            {figures.map(item => (
              <li key={item.label} className="grid gap-0.5 rounded-xl border border-slate-200 bg-white px-2 py-2.5">
                <strong className="text-base font-extrabold">{item.value.toLocaleString("en-GB")}</strong>
                <span className="text-[11px] leading-tight text-slate-600">{item.label}</span>
              </li>
            ))}
          </ul>
          {publicHref ? (
            <a href={publicHref} className="justify-self-start text-sm font-semibold text-brand-700 hover:underline">
              See it on Udozo
            </a>
          ) : null}
        </section>
      ) : null}
      {closed ? (
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5">
          <h1 className="text-xl font-extrabold">{listing.data.title}</h1>
          <p className="text-sm text-slate-600">
            {listing.data.status === "sold" ? "Sold: it no longer takes changes." : listing.data.status === "expired" ? "Expired: renew it from My listings to show it again." : "Removed by Udozo: it no longer shows on Udozo."}
          </p>
          <Link href="/account" className="justify-self-start font-semibold text-brand-700 hover:underline">
            Back to my listings
          </Link>
        </div>
      ) : (
        <ListingForm listing={listing.data} categories={reference.categories} states={reference.states} currency={market.currency} country={market.country} phoneConfirmed={customer.phone_verified} minPhotos={4} assistant={assistant} resale={resale} />
      )}
    </div>
  );
}
