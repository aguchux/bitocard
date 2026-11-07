import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, MapPin, PackageOpen, ShieldCheck, Tag, Users } from "lucide-react";
import { brandInitials, brandInk, brandPath, brandTint, categoryPath, type ShopBrandPage, type ShopSearch } from "@bitocard/api-client/classifieds";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ShopIcon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { ListingGrid } from "@/components/listing-card";
import { SellerShare } from "@/components/seller-share";
import { marketFor, shopApi } from "@/lib/api";
import { brandHref, brandIn, brandListingsQuery, brandPageSize, brandSlugPattern, brandSortLabels, brandSorts, brandStats, categoriesText, isBrandFiltered, readBrandFilters } from "@/lib/brand-page";
import { siteOrigin } from "@/lib/customer";
import { brandCardUrl } from "@/lib/brand-card";
import { gifSizes } from "@/lib/seller-card";
import { indexFrom } from "@/lib/search";
import { brandJsonLd, breadcrumbJsonLd, itemListJsonLd, noindexFollow } from "@/lib/seo";
import { sellHref } from "@/lib/sell-sources";

type Props = { params: Promise<{ cc: string; slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The brand an address names in a market, while the registry has it on; anything that cannot be a slug never reaches the API. */
async function load(slug: string, cc: string) {
  if (slug.length > 80 || !brandSlugPattern.test(slug)) return null;
  const result = await shopApi<ShopBrandPage>(`/v1/classifieds/brands/${slug}?country=${cc.toUpperCase()}`);
  return result.ok ? result.data : null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { cc, slug } = await params;
  const [market, brand] = await Promise.all([marketFor(cc), load(slug, cc)]);
  if (!market || !brand) return { title: "This brand is not on Udozo", robots: noindexFollow };
  const path = brandPath(cc, brand.slug);
  const kinds = categoriesText(brand.categories.filter(item => item.listings > 0), 3);
  const title = brand.listings ? `${brand.name} for sale in ${market.name}: ${brand.listings.toLocaleString("en-GB")} listing${brand.listings === 1 ? "" : "s"} on Udozo` : `${brand.name} in ${market.name} on Udozo`;
  const description = brand.listings
    ? `Buy ${brand.name}${kinds ? ` ${kinds}` : ""} in ${market.name} from ${brand.sellers.toLocaleString("en-GB")} seller${brand.sellers === 1 ? "" : "s"} on Udozo. Compare prices, chat with sellers and pay with Safe pay.`
    : `Nothing from ${brand.name} is for sale in ${market.name} on Udozo yet. Sell yours, or see what else is for sale.`;
  // Indexed once it has enough for sale, and only the page itself (not filtered or later pages).
  const filtered = isBrandFiltered(await searchParams);
  // The animated card first (WhatsApp and others show its first frame, the same card), then the still one, which X uses:
  // the brand's listings' photos, picked at random, beside its logo.
  const origin = siteOrigin();
  const alt = `${brand.name} on Udozo: ${brand.listings ? `${brand.listings.toLocaleString("en-GB")} listing${brand.listings === 1 ? "" : "s"} for sale in ${market.name}` : `sell yours in ${market.name}`}`;
  const still = { url: brandCardUrl(origin, cc, brand.slug, "jpg"), width: 1200, height: 630, type: "image/jpeg", alt };
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", url: path, title, description, siteName: "Udozo", images: [{ url: brandCardUrl(origin, cc, brand.slug, "gif"), ...gifSizes[0], type: "image/gif", alt }, still] },
    twitter: { card: "summary_large_image", title, description, images: [still] },
    ...(brand.listings < indexFrom || filtered ? { robots: noindexFollow } : {}),
  };
}

/** The brand's logo large on a white tile, or its initials on its colour. */
function BrandMark({ brand }: { brand: ShopBrandPage }) {
  const frame = "grid size-24 shrink-0 place-items-center rounded-3xl shadow-md ring-4 ring-white sm:size-28";
  if (brand.logo_url) {
    return (
      <span className={`${frame} bg-white p-4`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a logo from Udozo's registry, any host */}
        <img src={brand.logo_url} alt={`${brand.name} logo`} decoding="async" className="size-full object-contain" />
      </span>
    );
  }
  const tint = brandTint(brand);
  return (
    <span className={`${frame} text-3xl font-extrabold tracking-tight sm:text-4xl`} style={{ background: tint, color: brandInk(tint) }} aria-hidden="true">
      {brandInitials(brand.name)}
    </span>
  );
}

/**
 * A brand's public page in a market (`/ng/brand/hp`), from Udozo's brand registry: its logo and name, how much is for
 * sale under it and from how many sellers, its categories (filtering the listings, each with a way to its category's
 * page filtered to the brand), its popular models, where its listings are, and its live listings with a sort and pages.
 * A brand with nothing for sale yet points to the categories it sells in and to selling one. Never an official store:
 * the page says the name and logo are their owner's.
 */
export default async function BrandPage({ params, searchParams }: Props) {
  const { cc, slug } = await params;
  const market = await marketFor(cc);
  if (!market) notFound();
  const brand = await load(slug, cc);
  if (!brand) notFound();
  const query = await searchParams;
  const filters = readBrandFilters(query, brand);
  const listings = brand.listings ? await shopApi<ShopSearch>(brandListingsQuery(cc, brand.slug, filters)) : null;

  const path = brandPath(cc, brand.slug);
  const origin = siteOrigin();
  const trail = [
    { name: market.name, path: `/${cc}` },
    { name: brand.name, path },
  ];
  const cards = listings?.ok ? listings.data.data : [];
  const total = listings?.ok ? listings.data.total : 0;
  const pages = Math.max(1, Math.ceil(total / brandPageSize));
  const selling = brand.categories.filter(item => item.listings > 0);
  const chosen = selling.find(item => item.slug === filters.category);
  const heading = [filters.model, chosen?.name].filter(Boolean).join(" · ") || `All ${brand.name}`;

  return (
    <div className="mx-auto max-w-[1400px] pb-10 sm:px-6 sm:pt-4 lg:px-8">
      <div className="hidden px-4 sm:block sm:px-0">
        <Breadcrumbs trail={trail} />
      </div>

      <section aria-labelledby="brand-name" className="overflow-hidden border-navy-200 bg-white sm:mt-4 sm:rounded-3xl sm:border">
        {/* The banner Udozo's admins gave the brand (4:1, as wide as the page), else Udozo's drawn one. */}
        <div className={`relative overflow-hidden bg-gradient-to-br from-navy-900 via-navy-700 to-brand-600 ${brand.banner_url ? "aspect-[4/1] max-h-72 min-h-28 w-full" : "h-28 sm:h-36"}`} aria-hidden="true">
          {brand.banner_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- an admin's checked upload on the media CDN.
            <img src={brand.banner_url} alt="" className="size-full object-cover" />
          ) : (
            <>
              <span className="absolute -top-16 -right-10 size-56 rounded-full bg-white/10" />
              <span className="absolute -bottom-20 left-1/3 size-48 rounded-full bg-brand-400/20" />
              <span className="absolute top-6 left-8 size-16 rounded-full border border-white/15" />
            </>
          )}
        </div>
        <div className="grid gap-4 px-4 pb-5 sm:px-6">
          {/* Drawn above the banner (it is positioned, so it would otherwise paint over the logo's top half). */}
          <div className="relative z-10 -mt-12 flex flex-wrap items-end justify-between gap-3 sm:-mt-14">
            <BrandMark brand={brand} />
            <SellerShare url={new URL(path, origin).href} name={`${brand.name} in ${market.name}`} />
          </div>
          <div className="grid gap-1.5">
            <h1 id="brand-name" className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              {brand.name}
            </h1>
            <p className="text-sm text-navy-600">
              {brand.listings
                ? `${brand.listings.toLocaleString("en-GB")} ${brand.name} listing${brand.listings === 1 ? "" : "s"} for sale in ${market.name}, from ${brand.sellers.toLocaleString("en-GB")} seller${brand.sellers === 1 ? "" : "s"} on Udozo.`
                : `Nothing from ${brand.name} is for sale in ${market.name} yet.`}
            </p>
          </div>
          {brand.listings ? (
            <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {brandStats(brand).map(stat => (
                <div key={stat.key} className="grid gap-0.5 rounded-2xl bg-navy-50 px-3.5 py-3">
                  <dt className="order-2 text-xs text-navy-600">{stat.label}</dt>
                  <dd className="order-1 text-xl font-extrabold tracking-tight">{stat.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-6 px-4 sm:px-0">
          {selling.length ? (
            <section aria-labelledby="by-category">
              <h2 id="by-category" className="mb-3 text-base font-bold">
                Shop {brand.name} by category
              </h2>
              <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                {selling.map(category => (
                  <li key={category.slug} className="min-w-0">
                    <Link
                      href={brandHref(cc, brand.slug, filters, { category: category.slug })}
                      aria-current={filters.category === category.slug ? "true" : undefined}
                      className="flex items-center gap-2.5 rounded-2xl border border-navy-200 bg-white p-2.5 hover:border-navy-400 aria-[current]:border-navy-900 aria-[current]:bg-navy-50"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                        <ShopIcon name={category.icon} className="size-5" />
                      </span>
                      <span className="grid min-w-0">
                        <span className="truncate text-sm font-bold">{category.name}</span>
                        <span className="truncate text-xs text-navy-600">
                          {category.listings.toLocaleString("en-GB")} listing{category.listings === 1 ? "" : "s"}
                          {category.parent ? ` · ${category.parent.name}` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {brand.models.length ? (
            <section aria-labelledby="models">
              <h2 id="models" className="mb-3 text-base font-bold">
                Popular {brand.name} models
              </h2>
              <ul className="flex flex-wrap gap-2">
                {brand.models.slice(0, 24).map(model => (
                  <li key={model.name}>
                    <Link
                      href={brandHref(cc, brand.slug, filters, { model: filters.model === model.name ? null : model.name })}
                      aria-current={filters.model === model.name ? "true" : undefined}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-navy-200 bg-white px-3.5 text-sm font-semibold hover:border-navy-400 aria-[current]:border-navy-900 aria-[current]:bg-navy-900 aria-[current]:text-white"
                    >
                      <Tag className="size-3.5 opacity-60" aria-hidden="true" /> {model.name}
                      <span className="text-xs font-normal opacity-70">{model.listings}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {brand.listings ? (
            <section aria-labelledby="listings-heading" id="listings" className="scroll-mt-24">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <h2 id="listings-heading" className="text-base font-bold">
                  {heading} <span className="font-normal text-navy-500">({total.toLocaleString("en-GB")})</span>
                </h2>
                <nav aria-label="Sort" className="flex gap-1 rounded-full bg-navy-50 p-1">
                  {brandSorts.map(sort => (
                    <Link
                      key={sort}
                      href={brandHref(cc, brand.slug, filters, { sort })}
                      aria-current={filters.sort === sort ? "true" : undefined}
                      className="rounded-full px-3 py-1.5 text-xs font-semibold text-navy-600 hover:text-navy-900 aria-[current]:bg-white aria-[current]:text-navy-900 aria-[current]:shadow-sm"
                    >
                      {brandSortLabels[sort]}
                    </Link>
                  ))}
                </nav>
              </div>
              {selling.length > 1 || filters.model ? (
                <nav aria-label="Categories" className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                  <ul className="flex gap-2 whitespace-nowrap">
                    <li>
                      <Link
                        href={brandHref(cc, brand.slug, filters, { category: null, model: null })}
                        aria-current={!filters.category && !filters.model ? "true" : undefined}
                        className="flex h-9 items-center rounded-full border border-navy-200 bg-white px-3.5 text-sm font-semibold hover:border-navy-400 aria-[current]:border-navy-900 aria-[current]:bg-navy-900 aria-[current]:text-white"
                      >
                        All
                      </Link>
                    </li>
                    {selling.length > 1
                      ? selling.map(category => (
                          <li key={category.slug}>
                            <Link
                              href={brandHref(cc, brand.slug, filters, { category: category.slug })}
                              aria-current={filters.category === category.slug ? "true" : undefined}
                              className="flex h-9 items-center gap-1.5 rounded-full border border-navy-200 bg-white px-3.5 text-sm font-semibold hover:border-navy-400 aria-[current]:border-navy-900 aria-[current]:bg-navy-900 aria-[current]:text-white"
                            >
                              {category.name} <span className="text-xs font-normal opacity-70">{category.listings}</span>
                            </Link>
                          </li>
                        ))
                      : null}
                  </ul>
                </nav>
              ) : null}
              {chosen ? (
                <p className="mb-3 text-sm">
                  <Link href={brandIn(cc, brand, { category: chosen.slug })} className="font-semibold text-brand-700 hover:underline">
                    Filter {brand.name} {chosen.name.toLowerCase()} by price, condition and more
                  </Link>
                </p>
              ) : null}
              {listings && !listings.ok ? (
                <p className="rounded-2xl border border-dashed border-navy-200 p-6 text-center text-sm text-navy-600">Listings could not be loaded just now. Try again shortly.</p>
              ) : cards.length ? (
                <ListingGrid cards={cards} source="brand_page" />
              ) : (
                <p className="rounded-2xl border border-dashed border-navy-200 p-6 text-center text-sm text-navy-600">
                  Nothing matches just now.{" "}
                  <Link href={brandHref(cc, brand.slug, filters, { category: null, model: null })} className="font-semibold text-brand-700 hover:underline">
                    See all {brand.name}
                  </Link>
                </p>
              )}
              {pages > 1 ? (
                <nav aria-label="Pages" className="mt-5 flex items-center justify-center gap-3 text-sm">
                  {filters.page > 1 ? (
                    <Link href={brandHref(cc, brand.slug, filters, { page: filters.page - 1 })} className="inline-flex h-10 items-center gap-1 rounded-xl border border-navy-200 bg-white px-3.5 font-semibold hover:border-navy-400">
                      <ChevronLeft className="size-4" aria-hidden="true" /> Previous
                    </Link>
                  ) : null}
                  <span className="text-navy-600">
                    Page {filters.page} of {pages}
                  </span>
                  {filters.page < pages ? (
                    <Link href={brandHref(cc, brand.slug, filters, { page: filters.page + 1 })} className="inline-flex h-10 items-center gap-1 rounded-xl border border-navy-200 bg-white px-3.5 font-semibold hover:border-navy-400">
                      Next <ChevronRight className="size-4" aria-hidden="true" />
                    </Link>
                  ) : null}
                </nav>
              ) : null}
            </section>
          ) : (
            <section aria-labelledby="none-yet" className="grid justify-items-center gap-2 rounded-3xl border border-dashed border-navy-200 bg-white px-6 py-12 text-center">
              <span className="grid size-14 place-items-center rounded-full bg-navy-50 text-navy-500">
                <PackageOpen className="size-7" aria-hidden="true" />
              </span>
              <h2 id="none-yet" className="font-bold">
                No {brand.name} for sale in {market.name} yet
              </h2>
              <p className="max-w-sm text-sm text-navy-600">Have one to sell? Post it free and be the first. Or see what else is for sale.</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <Link href={sellHref("direct")} className="inline-flex h-10 items-center rounded-xl bg-navy-900 px-4 text-sm font-bold text-white">
                  Sell your {brand.name}
                </Link>
                <Link href={`/${cc}`} className="inline-flex h-10 items-center rounded-xl border border-navy-200 bg-white px-4 text-sm font-bold">
                  Browse {market.name}
                </Link>
              </div>
              {brand.categories.length ? (
                <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label={`Where ${brand.name} is sold`}>
                  {brand.categories.map(category => (
                    <li key={category.slug}>
                      <Link href={categoryPath(cc, category.slug)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-navy-200 bg-white px-3.5 text-sm font-semibold hover:border-navy-400">
                        <ShopIcon name={category.icon} className="size-3.5 text-navy-500" /> {category.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          )}
        </div>

        <aside className="grid content-start gap-4 px-4 sm:px-0 lg:sticky lg:top-4">
          {brand.states.length ? (
            <section aria-labelledby="where" className="grid gap-3 rounded-2xl border border-navy-200 bg-white p-4">
              <h2 id="where" className="flex items-center gap-2 font-bold">
                <MapPin className="size-5 text-brand-600" aria-hidden="true" /> {brand.name} near you
              </h2>
              <ul className="flex flex-wrap gap-2">
                {brand.states.map(state => (
                  <li key={state.slug}>
                    <Link href={brandIn(cc, brand, { state: state.slug })} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-navy-200 bg-white px-3.5 text-sm font-semibold hover:border-navy-400">
                      {state.name}
                      <span className="text-xs font-normal text-navy-500">{state.listings}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {brand.sellers ? (
            <section aria-labelledby="sellers" className="grid gap-1 rounded-2xl border border-navy-200 bg-white p-4">
              <h2 id="sellers" className="flex items-center gap-2 font-bold">
                <Users className="size-5 text-brand-600" aria-hidden="true" /> Sold by people on Udozo
              </h2>
              <p className="text-sm text-navy-700">Each listing is from its own seller. Open one to see who is selling, their reviews and how to reach them.</p>
            </section>
          ) : null}
          <section aria-labelledby="safe-trade" className="grid gap-2 rounded-2xl border border-mint-500/30 bg-mint-50 p-4">
            <h2 id="safe-trade" className="flex items-center gap-2 font-bold text-mint-700">
              <ShieldCheck className="size-5" aria-hidden="true" /> Buy safely
            </h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-navy-800">
              <li>Pay with Safe pay: the seller is paid only once you have the item.</li>
              <li>Check it is genuine: serial number, box and receipt where there are any.</li>
              <li>Never pay in advance. Udozo never asks for your codes.</li>
            </ul>
            <Link href="/safe-trade" className="text-sm font-semibold text-brand-700 hover:underline">
              Read the Safe Trade Guide
            </Link>
          </section>
          <p className="text-xs text-navy-500">
            The {brand.name} name and logo belong to their owner. Udozo is not {brand.name}&apos;s official store, and listings here are sellers&apos; own.
          </p>
        </aside>
      </div>

      <JsonLd data={brandJsonLd(brand, market.name, new URL(path, origin).href, brandCardUrl(origin, cc, brand.slug, "jpg"))} />
      <JsonLd data={breadcrumbJsonLd(trail, origin)} />
      {cards.length ? <JsonLd data={itemListJsonLd(`${brand.name} for sale in ${market.name}`, cards, origin, cc)} /> : null}
    </div>
  );
}
