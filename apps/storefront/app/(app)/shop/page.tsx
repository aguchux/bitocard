import type { Metadata } from "next";
import Link from "next/link";
import { listingStatusLabels, shopPriceText, type ShopMyListing, type ShopMyListings } from "@bitocard/api-client/classifieds";
import { ListingButtons } from "@/components/app/shop/listing-buttons";
import { ShopPills, ShopTitle } from "@/components/app/shop/shop-nav";
import { Thumb } from "@/components/app/shop/thumb";
import { customerApi } from "@/lib/customer";
import { listingActions, listingChannelTags, listingFilters, listingMeta, listingTones } from "@/lib/shop";
import { requireShop, shopAssistant, shopListingHref } from "@/lib/shop-server";

export const metadata: Metadata = { title: "Shop" };

type Props = { searchParams: Promise<{ status?: string; posted?: string }> };

const posted: Record<string, string> = {
  live: "Your ad is live on BitoCard Shop.",
  review: "Thanks: we are checking your ad. It goes live once approved, usually within a few hours.",
};

/**
 * The Shop tab (docs/BITOCARD_CLASSIFIEDS_PLAN.md, The Shop tab): the seller's figures and their listings by state,
 * each with what can be done to it. Posting is Post an ad; browsing is shop.bitocard.com.
 */
export default async function ShopHome({ searchParams }: Props) {
  const { status, posted: done } = await searchParams;
  const { shop, market } = await requireShop("/shop");
  const filter = listingFilters.find(item => item.status === status) ?? listingFilters[0]!;
  const [shown, all, assistant] = await Promise.all([
    customerApi<ShopMyListings>("GET", `/v1/classifieds/me/listings?limit=50${filter.status ? `&status=${filter.status}` : ""}`),
    filter.status ? customerApi<ShopMyListings>("GET", "/v1/classifieds/me/listings?limit=100") : null,
    shopAssistant(market.country),
  ]);
  const source = all ?? shown;
  const every = source.ok ? source.data.data : [];
  const listings = shown.ok ? shown.data.data : [];
  const count = (state: ShopMyListing["status"]) => every.filter(listing => listing.status === state).length;
  const stats = [
    { value: count("active"), label: "Active" },
    { value: count("pending_review"), label: "In review" },
    { value: every.reduce((sum, listing) => sum + listing.views, 0), label: "Views" },
    { value: every.reduce((sum, listing) => sum + listing.leads, 0), label: "Leads" },
  ];

  return (
    <div className="grid gap-5">
      <ShopTitle title="Shop" />
      <ShopPills shop={shop} active="/shop" />
      {done && posted[done] ? (
        <p role="status" className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          {posted[done]}
        </p>
      ) : null}

      <section aria-label="Your figures" className="grid grid-cols-4 gap-2 sm:max-w-xl">
        {stats.map(stat => (
          <div key={stat.label} className="grid gap-0.5 rounded-xl border border-slate-200 bg-white px-2 py-2.5 sm:px-3">
            <strong className="text-lg font-extrabold">{stat.value.toLocaleString("en-GB")}</strong>
            <span className="text-[11px] font-medium text-slate-600 sm:text-xs">{stat.label}</span>
          </div>
        ))}
      </section>

      <section aria-labelledby="my-listings" className="grid gap-3">
        <h2 id="my-listings" className="sr-only">
          My listings
        </h2>
        <nav aria-label="Listings by state" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
          <ul className="flex gap-2 whitespace-nowrap">
            {listingFilters.map(item => {
              const current = item === filter;
              return (
                <li key={item.label}>
                  <Link
                    href={item.status ? `/shop?status=${item.status}` : "/shop"}
                    aria-current={current ? "page" : undefined}
                    className={`flex h-8 items-center rounded-full px-3 text-[13px] font-semibold ${current ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:text-navy-900"}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {!shown.ok ? (
          <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">Your listings could not be loaded just now. Try again shortly.</p>
        ) : listings.length ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {listings.map(listing => (
              <li key={listing.id}>
                <article className="grid h-full gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                  <Link href={`/shop/listings/${listing.id}`} className="flex gap-3">
                    <Thumb url={listing.photos[0]?.url} />
                    <span className="grid min-w-0 content-start gap-1">
                      <span className="flex flex-wrap gap-1">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${listingTones[listing.status]}`}>{listingStatusLabels[listing.status]}</span>
                        {listingChannelTags(listing).map(tag => (
                          <span key={tag} className="rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-bold text-navy-700">
                            {tag}
                          </span>
                        ))}
                      </span>
                      <strong className="truncate text-sm leading-snug">{listing.title || "Untitled draft"}</strong>
                      <span className="text-[13px] font-bold">{listing.price.amount === null && listing.price.kind !== "on_request" ? "No price yet" : shopPriceText(listing.price)}</span>
                      <span className="text-xs text-slate-600">{listingMeta(listing)}</span>
                    </span>
                  </Link>
                  <ListingButtons id={listing.id} actions={listingActions(listing)} publicHref={shopListingHref(listing.url)} improve={assistant && listing.status === "active" ? assistant.name : null} />
                </article>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid justify-items-center gap-3 rounded-2xl border border-dashed border-slate-300 p-8 text-center">
            <p className="font-semibold">{filter.status ? `No ${filter.label.toLowerCase()} listings.` : "Sell what you don’t use."}</p>
            <p className="max-w-sm text-sm text-slate-600">Post an ad in about a minute: four photos, a title and a price. Buyers chat with you here, and can pay safely with Safe pay.</p>
            <Link href="/shop/post" className="flex h-11 items-center rounded-full bg-brand-700 px-5 font-bold text-white hover:bg-brand-600">
              Post an ad
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
