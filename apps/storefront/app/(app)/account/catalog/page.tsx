import type { Metadata } from "next";
import Link from "next/link";
import { X } from "lucide-react";
import type { StoreBrand, StoreList, StoreProduct } from "@bitocard/api-client/storefront";
import { appProductBase, Carousel, CarouselItem, SectionTitle } from "@/components/app/blocks";
import { BrandImage } from "@/components/store/brand-image";
import { ProductCard } from "@/components/store/product-card";
import { query, storeApi } from "@/lib/api";
import { inMarket } from "@/lib/market";
import { storeNavigation } from "@/lib/navigation";

export const metadata: Metadata = { title: "Catalog" };

type Search = { q?: string; group?: string; brand?: string };

const products = async (params: Record<string, string | number | undefined>) => {
  const result = await storeApi<StoreList<StoreProduct>>(await inMarket(`/v1/store/products${query(params)}`));
  return result.ok ? result.data.data : [];
};

/** A filter chip: a link that keeps the other filters. */
function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold whitespace-nowrap ${active ? "bg-[#070f4c] text-white" : "bg-white text-[#070f4c] ring-1 ring-slate-200 hover:ring-slate-300"}`}
    >
      {children}
    </Link>
  );
}

/** A brand as a round logo tile with its name, filtering the catalogue by it. */
function BrandTile({ brand }: { brand: StoreBrand }) {
  return (
    <Link href={`/account/catalog?brand=${encodeURIComponent(brand.slug)}`} className="flex flex-col items-center gap-2 rounded-2xl p-2 text-center hover:bg-white">
      <span className="grid size-16 place-items-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70" style={brand.logo_url ? undefined : { backgroundColor: brand.color ?? "#070f4c" }}>
        {brand.logo_url ? (
          <BrandImage src={brand.logo_url} className="h-10 w-10 object-contain" fallback={<span className="font-extrabold text-[#070f4c]">{brand.initials}</span>} />
        ) : (
          <span className="font-extrabold text-white">{brand.initials}</span>
        )}
      </span>
      <span className="line-clamp-2 text-xs font-semibold text-[#070f4c]">{brand.name}</span>
    </Link>
  );
}

/**
 * The catalogue inside the account app. Without filters: a carousel of products per category group and a carousel of
 * brands, so a long catalogue stays easy to scan on a phone. With a search, group or brand: a grid of matches.
 */
export default async function CatalogPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { q = "", group = "", brand = "" } = await searchParams;
  const navigation = await storeNavigation();
  const groups = navigation.groups.filter(item => item.on_sale);
  const filtered = Boolean(q || group || brand);
  const href = (next: Search) => `/account/catalog${query({ q: next.q, group: next.group, brand: next.brand })}`;

  const [rails, brands, matches] = await Promise.all([
    filtered ? Promise.resolve([]) : Promise.all(groups.map(async item => ({ group: item, products: await products({ group: item.key, sort: "popular", limit: 12 }) }))),
    storeApi<StoreList<StoreBrand>>(await inMarket(`/v1/store/brands${query({ limit: 24 })}`)).then(result => (result.ok ? result.data.data : [])),
    filtered ? products({ q: q || undefined, group: group || undefined, brand: brand || undefined, sort: "popular", limit: 60 }) : Promise.resolve([]),
  ]);
  const brandName = brand ? (brands.find(item => item.slug === brand)?.name ?? brand) : "";

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Catalog</h1>
        <p className="mt-1 text-slate-600">Everything you can buy, grouped to find it fast.</p>
      </div>

      {/* Group chips: a sideways row on phones, wrapping on wider screens. */}
      <nav aria-label="Categories" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:px-0">
        <Chip href={href({ q })} active={!group}>
          All
        </Chip>
        {groups.map(item => (
          <Chip key={item.key} href={href({ q, group: item.key, brand })} active={group === item.key}>
            {item.label}
          </Chip>
        ))}
      </nav>

      {filtered ? (
        <section aria-labelledby="results">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 id="results" className="text-xl font-extrabold tracking-tight">
              {q ? `Results for “${q}”` : brandName ? brandName : (groups.find(item => item.key === group)?.label ?? "Products")}
            </h2>
            {q ? (
              <Chip href={href({ group, brand })} active={false}>
                “{q}” <X className="size-4" aria-label="Clear search" />
              </Chip>
            ) : null}
            {brand ? (
              <Chip href={href({ q, group })} active={false}>
                {brandName} <X className="size-4" aria-label="Clear brand" />
              </Chip>
            ) : null}
          </div>
          {matches.length ? (
            <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
              {matches.map(product => (
                <li key={product.id}>
                  <ProductCard product={product} base={appProductBase} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-3xl bg-white p-6 text-slate-600 ring-1 ring-slate-200/70">
              Nothing matches yet.{" "}
              <Link href="/account/catalog" className="font-semibold text-[#2477ff] hover:underline">
                See everything
              </Link>
            </p>
          )}
        </section>
      ) : (
        <>
          {brands.length ? (
            <section aria-labelledby="brands">
              <SectionTitle id="brands" title="Brands" />
              <Carousel label="Brands">
                {brands.map(item => (
                  <CarouselItem key={item.slug} width="w-24">
                    <BrandTile brand={item} />
                  </CarouselItem>
                ))}
              </Carousel>
            </section>
          ) : null}
          {rails
            .filter(rail => rail.products.length)
            .map(rail => (
              <section key={rail.group.key} id={rail.group.key} aria-labelledby={`rail-${rail.group.key}`} className="scroll-mt-24">
                <SectionTitle id={`rail-${rail.group.key}`} title={rail.group.label} href={href({ group: rail.group.key })} />
                <Carousel label={rail.group.label}>
                  {rail.products.map(product => (
                    <CarouselItem key={product.id}>
                      <ProductCard product={product} base={appProductBase} />
                    </CarouselItem>
                  ))}
                </Carousel>
              </section>
            ))}
          {rails.every(rail => !rail.products.length) ? <p className="rounded-3xl bg-white p-6 text-slate-600 ring-1 ring-slate-200/70">Products are on their way. Check back soon.</p> : null}
        </>
      )}
    </div>
  );
}
