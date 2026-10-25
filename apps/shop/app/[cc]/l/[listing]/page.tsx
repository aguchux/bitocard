import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { BadgeCheck, MapPin, ShieldCheck } from "lucide-react";
import {
  badgeLabels,
  categoryPath,
  conditionLabels,
  deliveryLabels,
  descriptionBlocks,
  featureValueText,
  listingPath,
  listingRef,
  nameInitials,
  placePath,
  postedAgo,
  shopPriceText,
  type DescriptionSpan,
  type ShopChat,
  type ShopListingPage,
  type ShopSearch,
} from "@bitocard/api-client/classifieds";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Gallery } from "@/components/gallery";
import { ShopIcon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { ListingActions, SaveShare } from "@/components/listing-actions";
import { ListingGrid } from "@/components/listing-card";
import { marketFor, shopApi } from "@/lib/api";
import { currentCustomer, customerApi, siteOrigin } from "@/lib/customer";
import { buyButton } from "@/lib/buy";
import { myShopHref } from "@/lib/handoff";
import { breadcrumbJsonLd, listingJsonLd } from "@/lib/seo";
import type { ShopViewer } from "@bitocard/api-client/classifieds";

type Props = { params: Promise<{ cc: string; listing: string }> };

async function load(cc: string, segment: string) {
  const ref = listingRef(segment);
  if (!ref) return { listing: null, gone: false };
  const result = await shopApi<ShopListingPage>(`/v1/classifieds/listings/${ref}?country=${cc.toUpperCase()}`);
  return result.ok ? { listing: result.data, gone: false } : { listing: null, gone: result.status === 410 };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { cc, listing: segment } = await params;
  const { listing } = await load(cc, segment);
  if (!listing) return { title: "This listing is no longer on BitoCard Shop", robots: { index: false, follow: true } };
  const path = listingPath(cc, listing.ref, listing.slug);
  const price = shopPriceText(listing.price);
  const title = `${listing.title}, ${price}`;
  const description = `${listing.status === "sold" ? "Sold. " : ""}${listing.title} for ${price} in ${listing.area.name}, ${listing.area.state.name}. ${listing.condition ? `${conditionLabels[listing.condition]}. ` : ""}Chat with the seller on BitoCard Shop and pay with Safe pay.`;
  const cover = listing.photos[0];
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", url: path, title, description, ...(cover ? { images: [{ url: cover.url, ...(cover.width && cover.height ? { width: cover.width, height: cover.height } : {}), alt: listing.title }] } : {}) },
    twitter: { card: cover ? "summary_large_image" : "summary", title, description, ...(cover ? { images: [cover.url] } : {}) },
  };
}

function Spans({ spans }: { spans: DescriptionSpan[] }) {
  return spans.map((span, index) => (span.bold ? <strong key={index}>{span.text}</strong> : span.italic ? <em key={index}>{span.text}</em> : <span key={index}>{span.text}</span>));
}

/** The description's limited Markdown, rendered as text: paragraphs, bold, italic and lists only. */
function Description({ text }: { text: string | null }) {
  const blocks = descriptionBlocks(text);
  if (!blocks.length) return null;
  return (
    <div className="grid gap-3 text-[15px] leading-relaxed text-navy-800">
      {blocks.map((block, index) =>
        block.kind === "p" ? (
          <p key={index}>
            <Spans spans={block.spans} />
          </p>
        ) : block.kind === "ul" ? (
          <ul key={index} className="list-disc space-y-1 pl-5">
            {block.items.map((item, at) => (
              <li key={at}>
                <Spans spans={item} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={index} className="list-decimal space-y-1 pl-5">
            {block.items.map((item, at) => (
              <li key={at}>
                <Spans spans={item} />
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

/**
 * A listing's one public page (`/ng/l/<number>-<slug>`): gallery and video, price, condition, features, description,
 * the seller, the category's Safe trade checks, and the buyer's actions. A changed title keeps the number and sends the
 * old slug here; sold listings show as Sold with similar listings and no offer markup.
 */
export default async function ListingPage({ params }: Props) {
  const { cc, listing: segment } = await params;
  const market = await marketFor(cc);
  // Pages render alongside the layout, so each checks the market itself.
  if (!market) notFound();
  const { listing, gone } = await load(cc, segment);
  if (!listing) {
    if (gone) return <Gone cc={cc} />;
    notFound();
  }
  const path = listingPath(cc, listing.ref, listing.slug);
  if (segment !== `${listing.ref}-${listing.slug}`) permanentRedirect(path);

  const customer = await currentCustomer();
  const viewerResult = customer ? await customerApi<ShopViewer>("GET", `/v1/classifieds/listings/${listing.id}/viewer`) : null;
  const viewer = viewerResult?.ok ? viewerResult.data : null;
  const chatResult = viewer?.conversation_id ? await customerApi<ShopChat>("GET", `/v1/classifieds/conversations/${viewer.conversation_id}`) : null;
  const similar = await shopApi<ShopSearch>(`/v1/classifieds/listings?country=${market.country}&category=${listing.category.slug}&state=${listing.area.state.slug}&limit=9`);
  const others = similar.ok ? similar.data.data.filter(card => card.id !== listing.id).slice(0, 8) : [];

  const sold = listing.status === "sold";
  const buy = buyButton(listing, viewer, `/${cc}/l/${listing.ref}/buy`, market.safe_pay);
  const trail = [
    { name: market.name, path: `/${cc}` },
    ...(listing.category.parent ? [{ name: listing.category.parent.name, path: categoryPath(cc, listing.category.parent.slug) }] : []),
    { name: listing.category.name, path: categoryPath(cc, listing.category.slug) },
    { name: listing.title, path },
  ];
  const origin = siteOrigin();

  return (
    <article className="mx-auto max-w-6xl pb-6 sm:px-4 sm:pt-4">
      <div className="hidden px-4 pt-3 sm:block sm:px-0 sm:pt-0">
        <Breadcrumbs trail={trail} />
      </div>
      <div className="grid gap-6 sm:mt-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 content-start gap-5">
          <Gallery title={listing.title} photos={listing.photos} video={listing.video} />
          <section className="grid gap-2 px-4 sm:px-0">
            {sold ? <span className="w-fit rounded-full bg-navy-900 px-3 py-1 text-xs font-bold text-white">Sold</span> : null}
            {listing.reserved && !sold ? <span className="w-fit rounded-full bg-mint-50 px-3 py-1 text-xs font-bold text-mint-700">Reserved with Safe pay</span> : null}
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-wrap items-baseline gap-x-2.5">
                <strong className={`text-[26px] font-extrabold tracking-tight ${sold ? "text-navy-500 line-through" : ""}`}>{shopPriceText(listing.price)}</strong>
                {listing.price.kind === "negotiable" ? <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-700">Negotiable</span> : null}
              </div>
              <SaveShare listing={{ id: listing.id, title: listing.title, url: new URL(path, origin).href }} viewer={viewer} signedIn={Boolean(customer)} />
            </div>
            <h1 className="text-xl leading-snug font-bold">{listing.title}</h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-navy-600">
              <Link href={placePath(cc, { state: listing.area.state.slug, area: listing.area.slug })} className="inline-flex items-center gap-1 hover:underline">
                <MapPin className="size-4" aria-hidden="true" /> {listing.area.name}, {listing.area.state.name}
              </Link>
              <span>· {postedAgo(listing.published_at)}</span>
              {listing.condition ? <span className="rounded-full bg-navy-50 px-2.5 py-0.5 text-xs font-semibold text-navy-700">{conditionLabels[listing.condition]}</span> : null}
              <span className="text-xs">{deliveryLabels[listing.delivery]}</span>
            </p>
          </section>
          {listing.features.length ? (
            <section aria-labelledby="features" className="px-4 sm:px-0">
              <h2 id="features" className="mb-2.5 text-base font-bold">
                Features
              </h2>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {listing.features.map(feature => (
                  <div key={feature.key} className="flex items-center gap-2.5 rounded-xl border border-navy-200 bg-white p-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-navy-50 text-navy-700">
                      <ShopIcon name={feature.icon} className="size-4.5" />
                    </span>
                    <span className="grid min-w-0">
                      <dt className="truncate text-xs text-navy-600">{feature.name}</dt>
                      <dd className="truncate text-sm font-bold">{featureValueText(feature)}</dd>
                    </span>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
          {listing.description ? (
            <section aria-labelledby="description" className="px-4 sm:px-0">
              <h2 id="description" className="mb-2.5 text-base font-bold">
                Description
              </h2>
              <Description text={listing.description} />
            </section>
          ) : null}
        </div>
        <aside className="grid content-start gap-4 px-4 sm:px-0 lg:sticky lg:top-4">
          {sold ? (
            <p className="rounded-2xl bg-navy-50 p-4 text-sm text-navy-700">This was sold{listing.sold_at ? ` ${postedAgo(listing.sold_at).toLowerCase()}` : ""}. Similar listings are below.</p>
          ) : (
            <ListingActions
              listing={{ id: listing.id, title: listing.title, url: new URL(path, origin).href, currency: listing.price.currency, active: listing.status === "active", chat: listing.contact.chat, phone: listing.contact.phone, buyPath: `/${cc}/l/${listing.ref}/buy`, buyHref: buy?.href ?? null, buyLabel: buy?.label ?? "" }}
              viewer={viewer}
              signedIn={Boolean(customer)}
              chat={chatResult?.ok ? chatResult.data : null}
              messagesHref={customer?.country && viewer?.conversation_id ? myShopHref(customer.country, `/shop/messages/${viewer.conversation_id}`) : customer?.country ? myShopHref(customer.country, "/shop/messages") : null}
            />
          )}
          <section aria-label="The seller" className="grid gap-3 rounded-2xl border border-navy-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-navy-900 font-bold text-white" aria-hidden="true">
                {nameInitials(listing.seller.name)}
              </span>
              <span className="grid">
                <strong>{listing.seller.name}</strong>
                <span className="text-xs text-navy-600">
                  On BitoCard since {new Date(listing.seller.member_since).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
                  {listing.seller.response_rate !== null ? ` · answers ${listing.seller.response_rate}% of chats` : ""}
                </span>
              </span>
            </div>
            {listing.seller.badges.length ? (
              <div className="flex flex-wrap gap-2">
                {listing.seller.badges.map(badge => (
                  <span key={badge} className="inline-flex items-center gap-1 rounded-full bg-mint-50 px-2.5 py-1 text-xs font-bold text-mint-700">
                    <BadgeCheck className="size-3.5" aria-hidden="true" /> {badgeLabels[badge]}
                  </span>
                ))}
              </div>
            ) : null}
            <span className="text-xs text-navy-600">
              {listing.seller.active_listings} live listing{listing.seller.active_listings === 1 ? "" : "s"}
            </span>
          </section>
          <section aria-labelledby="safe-trade" className="grid gap-2 rounded-2xl border border-mint-500/30 bg-mint-50 p-4 text-mint-700">
            <h2 id="safe-trade" className="flex items-center gap-2 font-bold">
              <ShieldCheck className="size-5" aria-hidden="true" /> Safe trade
            </h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-navy-800">
              <li>Use Safe pay, or meet in a busy public place.</li>
              {listing.category.safety_checklist.slice(0, 3).map(item => (
                <li key={item}>{item}</li>
              ))}
              <li>Never pay in advance. BitoCard never asks for your codes.</li>
            </ul>
            <Link href="/safe-trade" className="text-sm font-semibold text-brand-700 hover:underline">
              Read the Safe Trade Guide
            </Link>
          </section>
        </aside>
      </div>
      {others.length ? (
        <section aria-labelledby="similar" className="mt-8 px-4 sm:px-0">
          <h2 id="similar" className="mb-3 text-base font-bold">
            {sold ? "Similar listings" : `More ${listing.category.name.toLowerCase()} in ${listing.area.state.name}`}
          </h2>
          <ListingGrid cards={others} />
        </section>
      ) : null}
      <JsonLd data={listingJsonLd(listing, origin, cc)} />
      <JsonLd data={breadcrumbJsonLd(trail, origin)} />
    </article>
  );
}

/** Gone (sold over 30 days ago, expired or removed): the proxy answers these with 410; this is what the page shows. */
function Gone({ cc }: { cc: string }) {
  return (
    <div className="mx-auto grid max-w-md gap-3 px-4 py-14 text-center">
      <h1 className="text-2xl font-extrabold">This listing is no longer on BitoCard Shop</h1>
      <p className="text-navy-600">It was sold, or the seller took it down.</p>
      <Link href={`/${cc}`} className="mx-auto flex h-11 items-center rounded-xl bg-navy-900 px-5 font-bold text-white">
        See what is for sale
      </Link>
    </div>
  );
}
