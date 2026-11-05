import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { AtSign, BadgeCheck, CalendarDays, Star, ChevronLeft, ChevronRight, MapPin, PackageOpen, ShieldCheck, Store } from "lucide-react";
import { badgeLabels, placePath, sellerPath, sellerSlug, type ShopChat, type ShopSearch, type ShopSellerProfile, type ShopSellerReviews, type ShopViewer, type UsernameStatus } from "@bitocard/api-client/classifieds";
import { Avatar } from "@bitocard/ui/avatar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ShopIcon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { ListingGrid } from "@/components/listing-card";
import { SellerContactPanel } from "@/components/seller-contact";
import { SellerShare } from "@/components/seller-share";
import { marketFor, shopApi } from "@/lib/api";
import { currentCustomer, customerApi, siteOrigin } from "@/lib/customer";
import { gifSizes, sellerCardUrl } from "@/lib/seller-card";
import { isSellerKey, placesText, queryString, readSellerFilters, sellerHref, sellerListingsQuery, sellerPageSize, sellerSortLabels, sellerSorts, sellerStats, sinceText } from "@/lib/seller";
import { usernameNudge } from "@/lib/username";
import { ReviewCard, ReviewSummaryBar } from "@/components/reviews/review-view";
import { readReviewFilters, reviewPath, reviewsHref, reviewPageSize, sellerReviewsQuery, summaryText } from "@/lib/reviews";
import { breadcrumbJsonLd, itemListJsonLd, noindexFollow, sellerJsonLd } from "@/lib/seo";

type Props = { params: Promise<{ cc: string; handle: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The profile as the API answers it: an old username in its 90 days also names where the seller is now. */
type Loaded = ShopSellerProfile;

/**
 * The seller an address names: their username or their handle (the folder keeps its old name), whichever the API knows,
 * typed in any case. Anything that cannot be either never reaches the API.
 */
async function load(key: string) {
  const lower = key.toLowerCase();
  if (!isSellerKey(lower)) return null;
  const result = await shopApi<Loaded>(`/v1/classifieds/sellers/${lower}`);
  return result.ok ? result.data : null;
}

/** Where the seller's page is now: the API's `redirect` (an old username), else their username once chosen, else their handle. */
const slugOf = (profile: Loaded) => profile.redirect || sellerSlug(profile);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { cc, handle } = await params;
  const [market, profile] = await Promise.all([marketFor(cc), load(handle)]);
  if (!market || !profile) return { title: "This seller is not on Udozo", robots: noindexFollow };
  const slug = slugOf(profile);
  const path = sellerPath(profile.country, slug);
  const where = placesText(profile.states);
  const title = `${profile.name}: ${profile.active_listings} listing${profile.active_listings === 1 ? "" : "s"} for sale on Udozo`;
  const description = `Shop from ${profile.name}${where ? ` in ${where}` : ""} on Udozo: ${profile.categories
    .slice(0, 3)
    .map(item => item.name.toLowerCase())
    .join(", ")}${profile.categories.length ? ". " : ""}Chat with the seller and pay with Safe pay.`;
  const query = await searchParams;
  // Indexed while they have something for sale, and only the page itself (not filtered or later pages).
  const filtered = Object.keys(query).some(key => ["category", "sort", "page", "rv_product", "rv_sort", "rv_page"].includes(key));
  // The animated card first (WhatsApp and others show its first frame, the same card), then the still one, which X uses.
  const origin = siteOrigin();
  const alt = `${profile.name} on Udozo: ${profile.active_listings} listing${profile.active_listings === 1 ? "" : "s"} for sale`;
  const still = { url: sellerCardUrl(origin, slug, "jpg"), width: 1200, height: 630, type: "image/jpeg", alt };
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "profile", url: path, title, description, siteName: "Udozo", images: [{ url: sellerCardUrl(origin, slug, "gif"), ...gifSizes[0], type: "image/gif", alt }, still] },
    twitter: { card: "summary_large_image", title, description, images: [still] },
    ...(profile.active_listings === 0 || filtered ? { robots: noindexFollow } : {}),
  };
}

/**
 * Every account's public seller page (`/ng/seller/<username>`, else `/ng/seller/<handle>`): who they are as their
 * listings show them (first name and initial, badges, since when), their figures, what they sell and where, their live
 * listings by category with a sort and pages, and the same ways to get in touch as on a listing, about the listing the
 * buyer chooses. One address per seller: their handle once they have a username, an old username in its 90 days, another
 * market's address or another case all redirect for good to the current one, keeping the query string. The seller
 * themselves, with no username yet, is offered one above their listings.
 */
export default async function SellerPage({ params, searchParams }: Props) {
  const { cc, handle } = await params;
  const market = await marketFor(cc);
  if (!market) notFound();
  const profile = await load(handle);
  if (!profile) notFound();
  const slug = slugOf(profile);
  const query = await searchParams;
  if (profile.country.toLowerCase() !== cc.toLowerCase() || handle !== slug) permanentRedirect(`${sellerPath(profile.country, slug)}${queryString(query)}`);

  const filters = readSellerFilters(query, profile);
  const customer = await currentCustomer();
  const firstListing = profile.contact_listings[0];
  const reviewFilters = readReviewFilters(query);
  const [listings, viewer, reviewPage] = await Promise.all([
    shopApi<ShopSearch>(sellerListingsQuery(cc, profile.handle, filters)),
    customer && firstListing ? customerApi<ShopViewer>("GET", `/v1/classifieds/listings/${firstListing.id}/viewer`) : null,
    // Reviews where they are open in the market (the profile's summary is null otherwise).
    profile.reviews ? shopApi<ShopSellerReviews>(sellerReviewsQuery(profile.handle, reviewFilters)) : null,
  ]);
  const reviews = reviewPage?.ok ? reviewPage.data : null;
  const firstViewer = viewer?.ok ? viewer.data : null;
  // The seller on their own page (their account's handle, else a listing of theirs, says so) with no username yet: what it takes to choose one.
  const own = (customer?.seller_handle ? customer.seller_handle === profile.handle : false) || Boolean(firstViewer?.own);
  const [chat, usernameStatus] = await Promise.all([
    firstViewer?.conversation_id ? customerApi<ShopChat>("GET", `/v1/classifieds/conversations/${firstViewer.conversation_id}`) : null,
    own && !profile.username ? customerApi<UsernameStatus>("GET", "/v1/store/account/username") : null,
  ]);
  const nudge = usernameStatus?.ok ? usernameNudge(usernameStatus.data) : null;

  const path = sellerPath(cc, slug);
  const origin = siteOrigin();
  const trail = [
    { name: market.name, path: `/${cc}` },
    { name: profile.name, path },
  ];
  const where = placesText(profile.states);
  const cards = listings.ok ? listings.data.data : [];
  const total = listings.ok ? listings.data.total : 0;
  const pages = Math.max(1, Math.ceil(total / sellerPageSize));
  const chosen = profile.categories.find(item => item.slug === filters.category);

  return (
    <div className="mx-auto max-w-[1400px] pb-10 sm:px-6 sm:pt-4 lg:px-8">
      <div className="hidden px-4 sm:block sm:px-0">
        <Breadcrumbs trail={trail} />
      </div>

      <section aria-labelledby="seller-name" className="overflow-hidden border-navy-200 bg-white sm:mt-4 sm:rounded-3xl sm:border">
        <div className="relative h-28 overflow-hidden bg-gradient-to-br from-navy-900 via-navy-700 to-brand-600 sm:h-36" aria-hidden="true">
          <span className="absolute -top-16 -right-10 size-56 rounded-full bg-white/10" />
          <span className="absolute -bottom-20 left-1/3 size-48 rounded-full bg-brand-400/20" />
          <span className="absolute top-6 left-8 size-16 rounded-full border border-white/15" />
        </div>
        <div className="grid gap-4 px-4 pb-5 sm:px-6">
          {/* Drawn above the banner (it is positioned, so it would otherwise paint over the photo's top half). */}
          <div className="relative z-10 -mt-12 flex flex-wrap items-end justify-between gap-3 sm:-mt-14">
            <Avatar name={profile.name} url={profile.avatar_url} label={profile.avatar_url ? `${profile.name}'s photo` : undefined} className="size-24 text-3xl font-extrabold tracking-tight shadow-md ring-4 ring-white sm:size-28 sm:text-4xl" />
            <SellerShare url={new URL(path, origin).href} name={profile.name} />
          </div>
          <div className="grid gap-2">
            <h1 id="seller-name" className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              {profile.name}
            </h1>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-navy-600">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-4" aria-hidden="true" /> On Udozo since {sinceText(profile.member_since)}
              </span>
              {summaryText(profile.reviews) ? (
                <a href="#reviews" className="inline-flex items-center gap-1.5 font-semibold text-navy-900 hover:underline">
                  <Star className="size-4 fill-amber-400 text-amber-500" aria-hidden="true" /> {summaryText(profile.reviews)}
                </a>
              ) : null}
              {where ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-4" aria-hidden="true" /> Sells in {where}
                </span>
              ) : null}
            </p>
            {profile.badges.length ? (
              <ul className="flex flex-wrap gap-2" aria-label="Checks">
                {profile.badges.map(badge => (
                  <li key={badge} className="inline-flex items-center gap-1 rounded-full bg-mint-50 px-2.5 py-1 text-xs font-bold text-mint-700">
                    <BadgeCheck className="size-3.5" aria-hidden="true" /> {badgeLabels[badge]}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {sellerStats(profile).map(stat => (
              <div key={stat.key} className="grid gap-0.5 rounded-2xl bg-navy-50 px-3.5 py-3">
                <dt className="order-2 text-xs text-navy-600">{stat.label}</dt>
                <dd className="order-1 text-xl font-extrabold tracking-tight">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 content-start gap-6 px-4 sm:px-0">
          {profile.categories.length ? (
            <section aria-labelledby="sells">
              <h2 id="sells" className="mb-3 text-base font-bold">
                What {profile.name} sells
              </h2>
              <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                {profile.categories.map(category => (
                  <li key={category.slug} className="min-w-0">
                    <Link
                      href={sellerHref(cc, slug, filters, { category: category.slug })}
                      aria-current={filters.category === category.slug ? "true" : undefined}
                      className="flex items-center gap-2.5 rounded-2xl border border-navy-200 bg-white p-2.5 hover:border-navy-400 aria-[current]:border-navy-900 aria-[current]:bg-navy-50"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                        <ShopIcon name={category.icon} className="size-5" />
                      </span>
                      <span className="grid min-w-0">
                        <span className="truncate text-sm font-bold">{category.name}</span>
                        <span className="truncate text-xs text-navy-600">
                          {category.listings} listing{category.listings === 1 ? "" : "s"}
                          {category.parent ? ` · ${category.parent.name}` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {profile.states.length ? (
            <section aria-labelledby="where">
              <h2 id="where" className="mb-3 text-base font-bold">
                Where their listings are
              </h2>
              <ul className="flex flex-wrap gap-2">
                {profile.states.map(state => (
                  <li key={state.slug}>
                    <Link href={placePath(cc, { state: state.slug })} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-navy-200 bg-white px-3.5 text-sm font-semibold hover:border-navy-400">
                      <MapPin className="size-3.5 text-navy-500" aria-hidden="true" /> {state.name}
                      <span className="text-xs font-normal text-navy-500">{state.listings}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {nudge ? (
            <aside aria-labelledby="username-nudge" className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-brand-700">
                <AtSign className="size-5" aria-hidden="true" />
              </span>
              <span className="grid min-w-0 flex-1 basis-48 gap-0.5">
                <strong id="username-nudge" className="text-sm">
                  {nudge.title}
                </strong>
                <span className="text-sm text-navy-700">{nudge.body}</span>
              </span>
              <Link href={nudge.href} className="inline-flex h-10 shrink-0 items-center rounded-xl bg-navy-900 px-4 text-sm font-bold text-white">
                {nudge.action}
              </Link>
            </aside>
          ) : null}

          <section aria-labelledby="listings-heading" id="listings" className="scroll-mt-24">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <h2 id="listings-heading" className="text-base font-bold">
                {chosen ? chosen.name : "All listings"} <span className="font-normal text-navy-500">({total.toLocaleString("en-GB")})</span>
              </h2>
              <nav aria-label="Sort" className="flex gap-1 rounded-full bg-navy-50 p-1">
                {sellerSorts.map(sort => (
                  <Link
                    key={sort}
                    href={sellerHref(cc, slug, filters, { sort })}
                    aria-current={filters.sort === sort ? "true" : undefined}
                    className="rounded-full px-3 py-1.5 text-xs font-semibold text-navy-600 hover:text-navy-900 aria-[current]:bg-white aria-[current]:text-navy-900 aria-[current]:shadow-sm"
                  >
                    {sellerSortLabels[sort]}
                  </Link>
                ))}
              </nav>
            </div>
            {profile.categories.length > 1 ? (
              <nav aria-label="Categories" className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <ul className="flex gap-2 whitespace-nowrap">
                  <li>
                    <Link href={sellerHref(cc, slug, filters, { category: null })} aria-current={!filters.category ? "true" : undefined} className="flex h-9 items-center rounded-full border border-navy-200 bg-white px-3.5 text-sm font-semibold hover:border-navy-400 aria-[current]:border-navy-900 aria-[current]:bg-navy-900 aria-[current]:text-white">
                      All
                    </Link>
                  </li>
                  {profile.categories.map(category => (
                    <li key={category.slug}>
                      <Link
                        href={sellerHref(cc, slug, filters, { category: category.slug })}
                        aria-current={filters.category === category.slug ? "true" : undefined}
                        className="flex h-9 items-center gap-1.5 rounded-full border border-navy-200 bg-white px-3.5 text-sm font-semibold hover:border-navy-400 aria-[current]:border-navy-900 aria-[current]:bg-navy-900 aria-[current]:text-white"
                      >
                        {category.name} <span className="text-xs font-normal opacity-70">{category.listings}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
            {!listings.ok ? (
              <p className="rounded-2xl border border-dashed border-navy-200 p-6 text-center text-sm text-navy-600">Listings could not be loaded just now. Try again shortly.</p>
            ) : cards.length ? (
              <ListingGrid cards={cards} source="seller_page" />
            ) : (
              <div className="grid justify-items-center gap-2 rounded-3xl border border-dashed border-navy-200 bg-white px-6 py-12 text-center">
                <span className="grid size-14 place-items-center rounded-full bg-navy-50 text-navy-500">
                  <PackageOpen className="size-7" aria-hidden="true" />
                </span>
                <p className="font-bold">Nothing for sale right now</p>
                <p className="max-w-sm text-sm text-navy-600">
                  {profile.sold_listings ? `${profile.name} has sold ${profile.sold_listings} on Udozo. ` : ""}Come back later, or see what else is for sale in {market.name}.
                </p>
                <Link href={`/${cc}`} className="mt-2 inline-flex h-10 items-center rounded-xl bg-navy-900 px-4 text-sm font-bold text-white">
                  Browse {market.name}
                </Link>
              </div>
            )}
            {pages > 1 ? (
              <nav aria-label="Pages" className="mt-5 flex items-center justify-center gap-3 text-sm">
                {filters.page > 1 ? (
                  <Link href={sellerHref(cc, slug, filters, { page: filters.page - 1 })} className="inline-flex h-10 items-center gap-1 rounded-xl border border-navy-200 bg-white px-3.5 font-semibold hover:border-navy-400">
                    <ChevronLeft className="size-4" aria-hidden="true" /> Previous
                  </Link>
                ) : null}
                <span className="text-navy-600">
                  Page {filters.page} of {pages}
                </span>
                {filters.page < pages ? (
                  <Link href={sellerHref(cc, slug, filters, { page: filters.page + 1 })} className="inline-flex h-10 items-center gap-1 rounded-xl border border-navy-200 bg-white px-3.5 font-semibold hover:border-navy-400">
                    Next <ChevronRight className="size-4" aria-hidden="true" />
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </section>
          {reviews ? (
            <section id="reviews" aria-labelledby="reviews-title" className="mt-8 grid gap-4">
              <h2 id="reviews-title" className="text-xl font-extrabold">
                Reviews of {profile.name}
              </h2>
              <ReviewSummaryBar summary={reviews.summary} />
              {reviews.products.length > 1 ? (
                <nav aria-label="Reviews by item" className="flex flex-wrap gap-2">
                  <Link href={reviewsHref(path, reviewFilters, { product: null })} aria-current={!reviewFilters.product ? "page" : undefined} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${!reviewFilters.product ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white"}`}>
                    All items
                  </Link>
                  {reviews.products.slice(0, 12).map(item => (
                    <Link key={item.key} href={reviewsHref(path, reviewFilters, { product: item.key })} aria-current={reviewFilters.product === item.key ? "page" : undefined} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${reviewFilters.product === item.key ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white"}`}>
                      {item.label} ({item.count})
                    </Link>
                  ))}
                </nav>
              ) : null}
              {reviews.total ? (
                <>
                  <p className="flex gap-3 text-sm">
                    <Link href={reviewsHref(path, reviewFilters, { sort: "newest" })} aria-current={reviewFilters.sort === "newest" ? "page" : undefined} className={reviewFilters.sort === "newest" ? "font-bold" : "text-navy-600 hover:underline"}>
                      Newest
                    </Link>
                    <Link href={reviewsHref(path, reviewFilters, { sort: "negative" })} aria-current={reviewFilters.sort === "negative" ? "page" : undefined} className={reviewFilters.sort === "negative" ? "font-bold" : "text-navy-600 hover:underline"}>
                      Negatives first
                    </Link>
                  </p>
                  <ul className="grid gap-3 lg:grid-cols-2">
                    {reviews.data.map(review => (
                      <li key={review.id}>
                        <ReviewCard review={review} href={reviewPath(path, review.id)} />
                      </li>
                    ))}
                  </ul>
                  {reviews.total > reviewPageSize ? (
                    <nav aria-label="Review pages" className="flex items-center justify-center gap-3 text-sm">
                      {reviewFilters.page > 1 ? (
                        <Link href={reviewsHref(path, reviewFilters, { page: reviewFilters.page - 1 })} className="inline-flex h-10 items-center rounded-xl border border-navy-200 bg-white px-3.5 font-semibold">
                          Newer
                        </Link>
                      ) : null}
                      <span className="text-navy-600">
                        Page {reviewFilters.page} of {Math.ceil(reviews.total / reviewPageSize)}
                      </span>
                      {reviewFilters.page * reviewPageSize < reviews.total ? (
                        <Link href={reviewsHref(path, reviewFilters, { page: reviewFilters.page + 1 })} className="inline-flex h-10 items-center rounded-xl border border-navy-200 bg-white px-3.5 font-semibold">
                          Older
                        </Link>
                      ) : null}
                    </nav>
                  ) : null}
                </>
              ) : (
                <p className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-600">No reviews yet. Buyers can rate {profile.name} after buying with Safe pay or a buy order.</p>
              )}
            </section>
          ) : null}
        </div>

        <aside className="grid content-start gap-4 px-4 sm:px-0 lg:sticky lg:top-4">
          <section aria-labelledby="contact" className="grid gap-3 rounded-2xl border border-navy-200 bg-white p-4">
            <h2 id="contact" className="flex items-center gap-2 font-bold">
              <Store className="size-5 text-brand-600" aria-hidden="true" /> Contact {profile.name}
            </h2>
            <SellerContactPanel
              cc={cc}
              seller={profile.name}
              listings={profile.contact_listings}
              first={{ viewer: firstViewer, chat: chat?.ok ? chat.data : null }}
              signedIn={Boolean(customer)}
              myPhone={customer?.phone_verified ? customer.phone : null}
            />
          </section>
          <section aria-labelledby="safe-trade" className="grid gap-2 rounded-2xl border border-mint-500/30 bg-mint-50 p-4">
            <h2 id="safe-trade" className="flex items-center gap-2 font-bold text-mint-700">
              <ShieldCheck className="size-5" aria-hidden="true" /> Buy safely
            </h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-navy-800">
              <li>Pay with Safe pay: the seller is paid only once you have the item.</li>
              <li>Meeting? Choose a busy public place and check the item first.</li>
              <li>Never pay in advance. Udozo never asks for your codes.</li>
            </ul>
            <Link href="/safe-trade" className="text-sm font-semibold text-brand-700 hover:underline">
              Read the Safe Trade Guide
            </Link>
          </section>
        </aside>
      </div>

      <JsonLd data={sellerJsonLd(profile, new URL(path, origin).href, sellerCardUrl(origin, slug, "jpg"))} />
      <JsonLd data={breadcrumbJsonLd(trail, origin)} />
      {cards.length ? <JsonLd data={itemListJsonLd(`Listings by ${profile.name}`, cards, origin, cc)} /> : null}
    </div>
  );
}
