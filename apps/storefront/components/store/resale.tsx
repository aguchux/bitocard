/* eslint-disable @next/next/no-img-element -- suppliers' photos from BitoCard Shop's storage, at their own sizes */
import Link from "next/link";
import { ArrowRight, BadgeCheck, MapPin, Search, ShieldCheck, Truck } from "lucide-react";
import { shopMoney } from "@bitocard/api-client/classifieds";
import type { ResaleCategoryTile, ResaleStoreListing, ResaleSupplierLine, ResolvedSection, StoreDesign } from "@bitocard/api-client/storefront";
import { deliveryText, resaleCondition, resaleListingPath, resaleSupplierPath } from "@/lib/resale-links";

/**
 * A Resale shop's listings (B2B reselling): BitoCard Shop suppliers' items at the store's prices. **Every listing names
 * its supplier, linking to their page on this store**: `SupplierLine` is part of the card and the listing page
 * themselves, never a section, so no template, design, home page or plan can leave it out.
 */

type Of<T extends ResolvedSection["type"]> = Extract<ResolvedSection, { type: T }>;
type Style = StoreDesign["style"];

/** "Supplied by Chinedu O." with their checked badge, linking to the supplier's page on this store. */
export function SupplierLine({ supplier, listingRef, className = "" }: { supplier: Pick<ResaleSupplierLine, "id" | "name" | "badges">; listingRef?: number; className?: string }) {
  return (
    <p className={`flex min-w-0 items-center gap-1.5 text-xs text-slate-500 ${className}`} data-supplier-line="">
      <span className="truncate">
        Supplied by{" "}
        <Link href={resaleSupplierPath(supplier.id, listingRef)} className="font-semibold text-navy-900 underline-offset-2 hover:underline">
          {supplier.name}
        </Link>
      </span>
      {supplier.badges.includes("id_checked") ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-emerald-700">
          <BadgeCheck className="size-3.5" aria-hidden="true" />
          ID checked
        </span>
      ) : null}
    </p>
  );
}

/** A listing in a rail or grid: the supplier's photo and title, the store's price, and who supplies it. */
export function ResaleCard({ item }: { item: ResaleStoreListing }) {
  const href = resaleListingPath(item);
  const condition = resaleCondition(item.condition);
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <Link href={href} className="block aspect-[4/3] overflow-hidden bg-slate-100">
        {item.cover ? <img src={item.cover.url} alt="" loading="lazy" className="size-full object-cover transition group-hover:scale-[1.02]" /> : null}
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="font-display line-clamp-2 text-[15px] leading-snug font-bold text-navy-900">
          <Link href={href} className="hover:underline">
            {item.title}
          </Link>
        </h3>
        <p className="font-display text-lg font-extrabold text-navy-900">{shopMoney(item.price, item.currency)}</p>
        <p className="flex flex-wrap gap-x-2 text-xs text-slate-500">
          {condition ? <span>{condition}</span> : null}
          {item.area ? <span>{item.area.name}</span> : null}
          {item.available <= 2 ? <span className="font-semibold text-amber-700">{item.available === 1 ? "Last one" : "2 left"}</span> : null}
        </p>
        {item.note ? <p className="line-clamp-2 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-700">{item.note}</p> : null}
        <SupplierLine supplier={item.supplier} listingRef={item.ref} className="mt-auto pt-1.5" />
      </div>
    </article>
  );
}

export function ResaleGrid({ items }: { items: ResaleStoreListing[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
      {items.map(item => (
        <li key={item.id} className="min-w-0">
          <ResaleCard item={item} />
        </li>
      ))}
    </ul>
  );
}

function Heading({ id, title, subtitle, href }: { id: string; title: string; subtitle?: string; href?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="font-display text-2xl font-extrabold tracking-tight text-navy-900 sm:text-3xl">
          {title}
        </h2>
        {subtitle ? <p className="mt-1 text-slate-500">{subtitle}</p> : null}
      </div>
      {href ? (
        <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
          See all <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

/** A row of listings that scrolls sideways on phones (snap, no page scroll), four across on desktops. */
export function ListingRail({ section }: { section: Of<"listing_rail"> }) {
  const id = `rail-${section.id}`;
  const all = section.viewAllHref ?? (section.source === "category" && section.category ? `/listings?category=${section.category}` : "/listings");
  return (
    <section aria-labelledby={id}>
      <Heading id={id} title={section.title} subtitle={section.subtitle} href={section.data.total > section.data.listings.length ? all : undefined} />
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4 [&::-webkit-scrollbar]:hidden">
        {section.data.listings.map(item => (
          <li key={item.id} className="w-[70%] shrink-0 snap-start sm:w-auto">
            <ResaleCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ListingGrid({ section }: { section: Of<"listing_grid"> }) {
  const id = `grid-${section.id}`;
  const all = `/listings${section.category ? `?category=${section.category}` : ""}`;
  return (
    <section aria-labelledby={id}>
      <Heading id={id} title={section.title} subtitle={section.subtitle} href={section.data.total > section.data.listings.length ? all : undefined} />
      <ResaleGrid items={section.data.listings} />
    </section>
  );
}

export function CategoryTiles({ categories }: { categories: ResaleCategoryTile[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {categories.map(category => (
        <li key={category.slug}>
          <Link href={`/listings?category=${category.slug}`} className="group relative block aspect-[4/3] overflow-hidden rounded-2xl bg-slate-200">
            {category.cover ? <img src={category.cover.url} alt="" loading="lazy" className="size-full object-cover transition group-hover:scale-105" /> : null}
            <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" aria-hidden="true" />
            <span className="absolute inset-x-3 bottom-3 text-white">
              <span className="font-display block text-base font-bold leading-tight">{category.name}</span>
              <span className="text-xs opacity-85">{category.count === 1 ? "1 item" : `${category.count} items`}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ResaleCategories({ section }: { section: Of<"resale_categories"> }) {
  const id = `cats-${section.id}`;
  return (
    <section aria-labelledby={id}>
      <Heading id={id} title={section.title} subtitle={section.subtitle} />
      <CategoryTiles categories={section.data.categories} />
    </section>
  );
}

/** Search the store's listings (`/listings?q=`). */
export function ResaleSearch({ className = "", defaultValue = "" }: { className?: string; defaultValue?: string }) {
  return (
    <form action="/listings" role="search" className={`flex h-12 items-center gap-2 rounded-xl bg-white px-3 text-navy-900 shadow-sm ring-1 ring-slate-200 ${className}`}>
      <Search className="size-5 shrink-0 text-slate-400" aria-hidden="true" />
      <label className="sr-only" htmlFor="resale-search">
        Search this store
      </label>
      <input id="resale-search" name="q" defaultValue={defaultValue} placeholder="Search this store" className="h-full min-w-0 flex-1 bg-transparent text-base outline-none" />
      <button type="submit" className="h-9 shrink-0 rounded-lg bg-brand-500 px-4 text-sm font-bold text-white hover:bg-brand-600">
        Search
      </button>
    </form>
  );
}

const promise = [
  [ShieldCheck, "Payment held until you have it"],
  [BadgeCheck, "Named, checked suppliers"],
  [Truck, "Delivery or meet-up"],
] as const;

/** A Resale shop's hero, in its variant: Showroom (photo mosaic), Shelf (a shelf of listings) or Aisle (search band). */
export function ResaleHero({ section, style, frame, inner }: { section: Of<"hero">; style: Style; frame: string; inner: string }) {
  const id = `hero-${section.id}`;
  const listings = section.data.listings ?? [];
  const categories = section.data.categories ?? [];
  const title = (
    <h1 id={id} className="font-display font-extrabold tracking-tight">
      {section.title}
      {section.accent ? <span className="block text-[var(--st-primary)]">{section.accent}</span> : null}
    </h1>
  );
  const promises = (
    <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm opacity-90">
      {promise.map(([Icon, text]) => (
        <li key={text} className="flex items-center gap-1.5">
          <Icon className="size-4" aria-hidden="true" /> {text}
        </li>
      ))}
    </ul>
  );

  if (style.hero === "shelf") {
    return (
      <section aria-labelledby={id} className={`${frame} text-center`} style={{ background: "linear-gradient(180deg, var(--st-hero-from), var(--st-hero-to))", color: "var(--st-hero-ink)" }}>
        <div className={`${inner} py-12 sm:py-16`}>
          <div className="mx-auto max-w-3xl text-4xl leading-tight sm:text-6xl">{title}</div>
          {section.subtitle ? <p className="mx-auto mt-4 max-w-xl text-lg opacity-80">{section.subtitle}</p> : null}
          {listings.length ? (
            <ul aria-label="From the shelf" className="mx-auto mt-10 grid max-w-4xl grid-cols-3 gap-3 sm:grid-cols-6">
              {listings.slice(0, 6).map(item => (
                <li key={item.id} className="aspect-square overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-black/5">
                  <Link href={resaleListingPath(item)} aria-label={item.title}>
                    {item.cover ? <img src={item.cover.url} alt="" className="size-full object-cover" /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <Link href="/listings" className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--st-primary)] px-6 font-semibold text-white hover:opacity-90">
            Browse everything <ArrowRight className="size-5" aria-hidden="true" />
          </Link>
        </div>
      </section>
    );
  }

  if (style.hero === "aisle") {
    return (
      <section aria-labelledby={id} className={frame} style={{ background: "linear-gradient(135deg, var(--st-hero-from), var(--st-hero-to))", color: "var(--st-hero-ink)" }}>
        <div className={`${inner} py-10 sm:py-14`}>
          <div className="max-w-3xl text-4xl leading-none uppercase sm:text-6xl">{title}</div>
          {section.subtitle ? <p className="mt-3 max-w-xl text-lg opacity-80">{section.subtitle}</p> : null}
          {section.search ? <ResaleSearch className="mt-6 max-w-2xl" /> : null}
          {section.categoryChips && categories.length ? (
            <ul className="mt-5 flex flex-wrap gap-2">
              {categories.map(category => (
                <li key={category.slug}>
                  <Link href={`/listings?category=${category.slug}`} className="inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold ring-1 ring-current/40 hover:bg-white/10">
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {promises}
        </div>
      </section>
    );
  }

  // Showroom: the headline beside a mosaic of the store's own listings' photos.
  return (
    <section aria-labelledby={id} className={frame} style={{ background: "linear-gradient(135deg, var(--st-hero-from), var(--st-hero-to))", color: "var(--st-hero-ink)" }}>
      <div className={`${inner} grid gap-10 py-12 sm:py-16 lg:grid-cols-2 lg:items-center`}>
        <div>
          <div className="text-4xl leading-[1.05] sm:text-6xl">{title}</div>
          {section.subtitle ? <p className="mt-4 max-w-xl text-lg opacity-85">{section.subtitle}</p> : null}
          {section.search ? <ResaleSearch className="mt-6 max-w-xl" /> : null}
          {promises}
        </div>
        {listings.length ? (
          <ul aria-label="In store now" className="grid grid-cols-3 gap-3">
            {listings.slice(0, 6).map((item, index) => (
              <li key={item.id} className={`aspect-square overflow-hidden rounded-2xl bg-white/10 shadow-xl ring-1 ring-white/10 ${index % 2 ? "translate-y-4" : ""}`}>
                <Link href={resaleListingPath(item)} aria-label={item.title}>
                  {item.cover ? <img src={item.cover.url} alt="" className="size-full object-cover" /> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

export const isResaleHero = (hero: Style["hero"]) => hero === "showroom" || hero === "shelf" || hero === "aisle";

/** Where a listing is and how it reaches the buyer. */
export function DeliveryNote({ item }: { item: Pick<ResaleStoreListing, "delivery" | "area"> }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-slate-600">
      {item.delivery === "none" ? <MapPin className="size-4" aria-hidden="true" /> : <Truck className="size-4" aria-hidden="true" />}
      {deliveryText(item.delivery, item.area)}
    </p>
  );
}
