import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { categoryPath, type ShopSearch } from "@bitocard/api-client/classifieds";
import { JsonLd } from "@/components/json-ld";
import { ListingGrid } from "@/components/listing-card";
import { SearchBar } from "@/components/search-bar";
import { CategoryStrip } from "@/components/category-strip";
import { marketFor, markets, shopApi } from "@/lib/api";
import { siteOrigin } from "@/lib/customer";
import { categoriesOf } from "@/lib/reference";
import { regionalAlternates } from "@/lib/seo";

type Props = { params: Promise<{ cc: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { cc } = await params;
  const [market, all] = await Promise.all([marketFor(cc), markets()]);
  if (!market) return {};
  const title = `BitoCard Shop ${market.name}: buy and sell near you`;
  const description = `Buy and sell phones, cars, property, electronics and more across ${market.name}. Chat with sellers and pay with Safe pay: BitoCard holds the money until you have the item.`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/${cc}`, languages: regionalAlternates(all.data, all.showcase, code => `/${code}`, "/") },
    openGraph: { url: `/${cc}`, title, description },
  };
}

/** A country's market: search with the area, the Safe pay promise, categories, and the newest listings. */
export default async function CountryHome({ params }: Props) {
  const { cc } = await params;
  const market = await marketFor(cc);
  // Pages render alongside the layout, so each checks the market itself.
  if (!market) notFound();
  const [categories, recent] = await Promise.all([categoriesOf(cc), shopApi<ShopSearch>(`/v1/classifieds/listings?country=${market.country}&sort=newest&limit=12`)]);
  return (
    <>
      <section className="bg-navy-900 pt-6 pb-6">
        <div className="mx-auto grid max-w-[1400px] px-4 sm:px-6 lg:px-8 gap-3.5">
          <h1 className="text-[22px] leading-tight font-extrabold text-white sm:text-3xl">
            Buy and sell near you,
            <br />
            <span className="text-brand-300">protected by Safe pay</span>
          </h1>
          <SearchBar country={market.country} />
          <Link href={`/${cc}/areas`} className="flex h-10 items-center gap-2 rounded-xl border border-navy-700 bg-navy-800 px-3 text-sm font-semibold text-white sm:max-w-sm">
            <MapPin className="size-4.5 text-brand-300" aria-hidden="true" />
            <span className="flex-1">Choose your area</span>
            <span className="text-[13px] font-medium text-navy-200">Near you first</span>
          </Link>
        </div>
      </section>
      <div className="mx-auto grid max-w-[1400px] gap-7 px-4 sm:px-6 lg:px-8 pt-4">
        {categories.length ? (
          <section aria-labelledby="categories">
            <h2 id="categories" className="mb-3 text-base font-bold">
              Categories
            </h2>
            <CategoryStrip categories={categories} href={slug => categoryPath(cc, slug)} />
          </section>
        ) : null}
        <section aria-labelledby="recent">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="recent" className="text-base font-bold">
              New across {market.name}
            </h2>
            <Link href={`/${cc}/search`} className="text-[13px] font-semibold text-brand-700 hover:underline">
              See all
            </Link>
          </div>
          {recent.ok && recent.data.data.length ? (
            <ListingGrid cards={recent.data.data} />
          ) : (
            <p className="rounded-2xl border border-dashed border-navy-200 p-6 text-center text-sm text-navy-600">{recent.ok ? "No listings yet. Be one of the first sellers here." : "Listings could not be loaded just now. Try again shortly."}</p>
          )}
        </section>
      </div>
      <JsonLd data={{ "@context": "https://schema.org", "@type": "WebSite", name: `BitoCard Shop ${market.name}`, url: `${siteOrigin()}/${cc}`, potentialAction: { "@type": "SearchAction", target: `${siteOrigin()}/${cc}/search?q={search_term_string}`, "query-input": "required name=search_term_string" } }} />
    </>
  );
}
