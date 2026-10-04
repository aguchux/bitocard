import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, CreditCard, Gift, Globe2, Signal, Smartphone } from "lucide-react";
import type { ResolvedSection, StoreBrand, StoreCountry, StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { brand as site } from "@bitocard/ui/site";
import { BrandArt, ProductCard, ProductRow } from "./product-card";
import { SearchForm } from "./layout";
import { CategoryIcon, GroupIcon } from "./category-icon";
import { groupInk, trustIcon } from "./theme";

// Literal class names, so Tailwind generates them.
const lgSpan = { 3: "lg:col-span-3", 4: "lg:col-span-4", 6: "lg:col-span-6", 8: "lg:col-span-8", 9: "lg:col-span-9", 12: "lg:col-span-12" } as const;
const mdSpan = { 3: "md:col-span-3", 6: "md:col-span-6" } as const;

const groupHref = (group: StoreNavigationGroup) => `/catalogs/${group.categories.length === 1 ? group.categories[0].category : group.key}`;

function Heading({ title, subtitle, href, children }: { title: string; subtitle?: string; href?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h2 className="font-display text-2xl font-extrabold tracking-tight text-[#070f4c] sm:text-3xl">{title}</h2>
        {subtitle ? <p className="mt-1 text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {href ? (
          <Link href={href} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 font-semibold text-[#e0116d] hover:bg-pink-50">
            View all <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Hero({ section, groups, countries, bleed = false }: { section: Extract<ResolvedSection, { type: "hero" }>; groups: StoreNavigationGroup[]; countries: StoreCountry[]; bleed?: boolean }) {
  const featured = section.data.featured.slice(0, 4);
  return (
    <section
      aria-labelledby={`hero-${section.id}`}
      className={`relative isolate bg-[#050a33] text-white ${bleed ? "ml-[calc(50%-50vw)] w-screen overflow-x-clip" : "overflow-x-clip rounded-3xl"}`}
    >
      {/* The banner: a lit globe with orbits on the right, darkened behind the text so it stays readable. */}
      <Image src="/hero/globe.webp" alt="" aria-hidden="true" fill priority sizes="100vw" className="-z-20 object-cover object-[72%_center] lg:object-right" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(5,10,51,.92),rgba(5,10,51,.7)_45%,rgba(5,10,51,.1)_75%)] lg:bg-[linear-gradient(90deg,rgba(5,10,51,.75),rgba(5,10,51,.35)_45%,transparent_65%)]" />
      <div className={`grid items-center gap-8 lg:grid-cols-12 ${bleed ? "mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-8 lg:py-12" : "px-5 py-10 sm:px-10 lg:px-14 lg:py-14"}`}>
        <div className="relative z-10 lg:col-span-7">
          <h1 id={`hero-${section.id}`} className="font-display text-4xl leading-[1.02] font-extrabold tracking-tight sm:text-6xl xl:text-7xl">
            {section.title}
            {section.accent ? (
              <>
                <br />
                <span className="text-[#ff2382]">{section.accent}</span>
              </>
            ) : null}
          </h1>
          {section.subtitle ? <p className="mt-4 max-w-2xl text-lg text-slate-200 sm:text-xl">{section.subtitle}</p> : null}
          {section.search ? (
            <div className="mt-7 max-w-3xl text-[#070f4c]">
              <SearchForm countries={countries} />
            </div>
          ) : null}
          {section.categoryChips && groups.length ? (
            // One line, no pills: icon and label only. On narrow screens the line scrolls sideways instead of wrapping.
            <ul className="-mx-1 mt-5 flex max-w-3xl items-center gap-x-4 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:gap-x-5 [&::-webkit-scrollbar]:hidden">
              {groups.map(group => (
                <li key={group.key} className="shrink-0">
                  <Link href={groupHref(group)} className="flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold whitespace-nowrap text-white/90 transition hover:text-white">
                    <GroupIcon group={group} className="size-8" ink={groupInk[group.key] ?? "text-pink-400"} tile="bg-white/10" />
                    {group.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <HeroArt featured={featured} />
      </div>
    </section>
  );
}

/** Floating brand cards (the featured brands) over the banner's globe; decoration only. */
function HeroArt({ featured }: { featured: StoreBrand[] }) {
  return (
    <div aria-hidden="true" className="relative hidden h-[22rem] lg:col-span-5 lg:block xl:h-[24rem]">
      {featured.map((brand, index) => (
        <FloatingTile key={brand.slug} brand={brand} index={index} />
      ))}
      {/* Small category badges around the globe. */}
      <span className="absolute top-[30%] left-[2%] grid size-12 -rotate-12 place-items-center rounded-xl bg-[#2477ff] shadow-xl ring-1 ring-white/30">
        <Smartphone className="size-6 text-white" />
      </span>
      <span className="absolute top-[4%] right-[2%] grid size-14 rotate-12 place-items-center rounded-2xl bg-[#ff2382] shadow-xl ring-1 ring-white/30">
        <Gift className="size-7 text-white" />
      </span>
      <span className="absolute right-[0%] bottom-[8%] grid size-12 rotate-12 place-items-center rounded-xl bg-[#2477ff] shadow-xl ring-1 ring-white/30">
        <CreditCard className="size-6 text-white" />
      </span>
      <span className="absolute top-[58%] left-[6%] size-9 rotate-12 rounded-lg bg-[#ff5ca8] shadow-xl" />
    </div>
  );
}

const tilePositions = [
  "left-[10%] top-[10%] w-40 h-28 -rotate-6",
  "right-[6%] top-[6%] w-44 h-28 rotate-6",
  "left-[24%] bottom-[5%] w-40 h-28 rotate-6",
  "right-[2%] bottom-[16%] w-40 h-28 -rotate-6",
];

function FloatingTile({ brand, index }: { brand: StoreBrand; index: number }) {
  return (
    <div className={`absolute overflow-hidden rounded-2xl shadow-[0_20px_45px_rgba(0,0,0,.45)] ring-1 ring-white/25 ${tilePositions[index]}`}>
      <BrandArt brand={brand} className="text-lg" />
    </div>
  );
}

function ProductRail({ section }: { section: Extract<ResolvedSection, { type: "product_rail" }> }) {
  const products = section.data.products;
  const tags = section.filters ? [...new Set(products.flatMap(product => product.brand.tags))].slice(0, 4) : [];
  return (
    <section aria-label={section.title} className="@container h-full">
      <Heading title={section.title} subtitle={section.subtitle} href={section.viewAllHref}>
        {section.filters ? (
          <nav aria-label={`${section.title} filters`} className="flex flex-wrap gap-2">
            <Link href="/catalogs" className="rounded-full border border-[#ff2382] px-4 py-1.5 text-sm font-semibold text-[#e0116d]">
              All
            </Link>
            <Link href="/catalogs?country=global" className="rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-600 hover:border-slate-300">
              Global
            </Link>
            {tags.map(tag => (
              <Link key={tag} href={`/catalogs?tag=${encodeURIComponent(tag)}`} className="rounded-full border border-slate-200 px-4 py-1.5 text-sm capitalize text-slate-600 hover:border-slate-300">
                {tag}
              </Link>
            ))}
          </nav>
        ) : null}
      </Heading>
      {products.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-slate-500">Products appear here soon.</p>
      ) : section.layout === "list" ? (
        <ul className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
          {products.map(product => (
            <li key={product.id}>
              <ProductRow product={product} />
            </li>
          ))}
        </ul>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 @md:hidden">
            {products.map(product => (
              <li key={product.id}>
                <ProductRow product={product} />
              </li>
            ))}
          </ul>
          <ul className="hidden gap-4 @md:grid @md:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4">
            {products.map(product => (
              <li key={product.id}>
                <ProductCard product={product} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function CategoryGrid({ section }: { section: Extract<ResolvedSection, { type: "category_grid" }> }) {
  return (
    <section aria-label={section.title} className="@container">
      <Heading title={section.title} subtitle={section.subtitle} />
      <ul className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-5 @6xl:grid-cols-9">
        {section.data.categories.map(category => {
          return (
            <li key={category.category}>
              <Link href={`/catalogs/${category.category}`} className="flex h-full flex-col items-start gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <CategoryIcon category={category.category} iconUrl={category.icon_url} className="size-14 rounded-xl" />
                <span>
                  <span className="font-display block font-bold text-[#070f4c]">{category.label}</span>
                  <span className="text-sm text-slate-500">{category.products} {category.products === 1 ? "product" : "products"}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BrandGrid({ section }: { section: Extract<ResolvedSection, { type: "brand_grid" }> }) {
  return (
    <section aria-label={section.title} className="@container">
      <Heading title={section.title} subtitle={section.subtitle} href={section.tag ? `/catalogs?tag=${encodeURIComponent(section.tag)}` : "/catalogs"} />
      <ul className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-6">
        {section.data.brands.map(brand => (
          <li key={brand.slug}>
            <Link href={`/catalogs?brand=${encodeURIComponent(brand.slug)}`} className="group block overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:shadow-md">
              <div className="aspect-[16/9]">
                <BrandArt brand={brand} className="text-lg" />
              </div>
              <p className="flex items-center justify-between px-3 py-2.5 text-sm">
                <span className="font-display truncate font-bold text-[#070f4c]">{brand.name}</span>
                <span className="text-slate-500">{brand.products}</span>
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const promoThemes = {
  pink: "bg-gradient-to-br from-pink-50 via-pink-100 to-fuchsia-100 text-[#070f4c]",
  sky: "bg-gradient-to-br from-sky-100 via-blue-50 to-indigo-100 text-[#070f4c]",
  navy: "bg-gradient-to-br from-[#070f4c] to-[#1a1f7a] text-white",
  light: "bg-white text-[#070f4c] ring-1 ring-slate-100",
  sunset: "bg-gradient-to-br from-amber-100 via-orange-100 to-pink-100 text-[#070f4c]",
} as const;

function PromoArt({ illustration }: { illustration: Extract<ResolvedSection, { type: "promo" }>["illustration"] }) {
  if (illustration === "none") return null;
  if (illustration === "store") {
    return (
      <div aria-hidden="true" className="relative mx-auto h-32 w-36 shrink-0">
        <div className="absolute inset-x-1 top-0 h-9 rounded-t-2xl bg-[repeating-linear-gradient(90deg,#ff2382_0_22px,#ffffff_22px_44px)] shadow-md" />
        <div className="absolute inset-x-3 top-9 bottom-0 grid place-items-center rounded-b-2xl bg-gradient-to-b from-blue-500 to-indigo-600 shadow-lg">
          <span className="grid size-16 place-items-center rounded-xl bg-white shadow">
            {/* eslint-disable-next-line @next/next/no-img-element -- the BitoCard mark from this app's public folder */}
            <img src={site.mark} alt="" className="h-10 w-auto" />
          </span>
        </div>
      </div>
    );
  }
  const Icon = illustration === "esim" ? Signal : illustration === "gift" ? Gift : Globe2;
  return (
    <div aria-hidden="true" className="mx-auto grid h-28 w-24 shrink-0 rotate-6 place-items-center rounded-3xl bg-gradient-to-br from-[#ff2382] to-[#c51065] text-white shadow-xl">
      <Icon className="size-12" />
    </div>
  );
}


function Promo({ section }: { section: Extract<ResolvedSection, { type: "promo" }> }) {
  const dark = section.theme === "navy";
  const external = section.cta?.href.startsWith("http");
  return (
    <section aria-label={section.title} className={`relative flex h-full flex-col overflow-hidden rounded-3xl p-6 sm:p-7 ${promoThemes[section.theme]}`}>
      {section.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- promo images are admin-set https addresses on any host
        <img src={section.imageUrl} alt="" className="absolute inset-0 -z-0 h-full w-full object-cover opacity-90" />
      ) : null}
      <div className="relative flex flex-1 flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-extrabold tracking-tight">{section.title}</h2>
          {section.subtitle ? <p className={`mt-1 text-lg ${dark ? "text-slate-200" : "text-slate-700"}`}>{section.subtitle}</p> : null}
          {section.body ? <p className={`mt-2 text-sm ${dark ? "text-slate-300" : "text-slate-600"}`}>{section.body}</p> : null}
          {section.bullets.length ? (
            <ul className="mt-3 space-y-1.5 text-sm">
              {section.bullets.map(item => (
                <li key={item} className="flex items-center gap-2">
                  <span className="grid size-5 place-items-center rounded-full bg-[#ff2382] text-white">
                    <Check className="size-3.5" aria-hidden="true" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
          {section.cta ? (
            <Link
              href={section.cta.href}
              {...(external ? { rel: "noopener" } : {})}
              className={`mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl px-5 font-semibold shadow-sm ${section.theme === "sky" || section.theme === "light" ? "bg-white text-[#070f4c] ring-1 ring-slate-200 hover:bg-slate-50" : "bg-[#ff2382] text-white hover:bg-[#e8116d]"}`}
            >
              {section.cta.label}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        {section.imageUrl ? null : <PromoArt illustration={section.illustration} />}
      </div>
    </section>
  );
}

function TrustBar({ section }: { section: Extract<ResolvedSection, { type: "trust_bar" }> }) {
  return (
    <section aria-label="Why shop with us" className="rounded-3xl bg-slate-50 p-5 sm:p-6">
      <ul className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        {section.items.map(item => {
          const Icon = trustIcon[item.icon];
          return (
            <li key={item.title} className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-pink-100 text-[#e0116d]">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span>
                <span className="font-display block text-sm font-bold text-[#070f4c] sm:text-base">{item.title}</span>
                {item.body ? <span className="text-sm text-slate-500">{item.body}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The home page: each section on the grid (12 columns on desktop, 6 on tablets, one on phones), densely packed. */
export function HomeSections({ sections, groups, countries }: { sections: ResolvedSection[]; groups: StoreNavigationGroup[]; countries: StoreCountry[] }) {
  // A full-width hero at the top runs edge to edge under the header (full bleed); the rest sit in the grid.
  const [first, ...others] = sections;
  const bleed = first?.type === "hero" && first.span.lg === 12 ? first : null;
  const grid = bleed ? others : sections;
  return (
    <>
      {bleed ? (
        <div className="relative z-20 -mt-6 mb-6 lg:mb-7">
          <Hero section={bleed} groups={groups} countries={countries} bleed />
        </div>
      ) : null}
    <div className="grid grid-flow-row-dense grid-cols-1 gap-6 md:grid-cols-6 lg:grid-cols-12 lg:gap-7">
      {grid.map(section => (
        <div key={section.id} className={`min-w-0 ${mdSpan[section.span.md]} ${lgSpan[section.span.lg]} ${section.span.rows === 2 ? "md:row-span-2" : ""}`}>
          {section.type === "hero" ? <Hero section={section} groups={groups} countries={countries} /> : null}
          {section.type === "product_rail" ? <ProductRail section={section} /> : null}
          {section.type === "category_grid" ? <CategoryGrid section={section} /> : null}
          {section.type === "brand_grid" ? <BrandGrid section={section} /> : null}
          {section.type === "promo" ? <Promo section={section} /> : null}
          {section.type === "trust_bar" ? <TrustBar section={section} /> : null}
        </div>
      ))}
    </div>
    </>
  );
}
