import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { ShopShowcase } from "@bitocard/api-client/classifieds";
import { Flag } from "@/components/flag";
import { ShopIcon } from "@/components/icon";
import { ListingGrid } from "@/components/listing-card";
import { markets, shopApi } from "@/lib/api";
import { currentCustomer } from "@/lib/customer";
import { regionalAlternates } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const all = await markets();
  return {
    title: { absolute: "BitoCard Shop across Africa: buy and sell near you" },
    description: `Buy and sell near you in ${all.data.map(market => market.name).join(", ") || "Africa"}, protected by Safe pay.`,
    alternates: { canonical: "/", languages: regionalAlternates(all.data, all.showcase, code => `/${code}`, "/") },
  };
}

/**
 * The global showcase, from the second country: the countries with their listings, the categories, and recent and
 * trending listings across them, never a price. With one country open, its market is the home page. Nothing is chosen
 * by cookie or address: a signed-in customer only sees "Continue to <their country>".
 */
export default async function GlobalHome() {
  const all = await markets();
  if (!all.showcase) {
    if (all.data.length === 1) redirect(`/${all.data[0]!.country.toLowerCase()}`);
    return (
      <div className="mx-auto grid max-w-md gap-3 px-4 py-16 text-center">
        <h1 className="text-2xl font-extrabold">BitoCard Shop is opening soon</h1>
        <p className="text-navy-600">Buy and sell near you, protected by Safe pay. Check back shortly.</p>
      </div>
    );
  }
  const [showcase, customer] = await Promise.all([shopApi<ShopShowcase>("/v1/classifieds/showcase"), currentCustomer()]);
  const own = all.data.find(market => market.country === customer?.country);
  return (
    <>
      <section className="bg-navy-900 pt-5 pb-6">
        <div className="mx-auto grid max-w-[1400px] px-4 sm:px-6 lg:px-8 gap-4">
          <h1 className="text-[22px] leading-tight font-extrabold text-white sm:text-3xl">
            BitoCard Shop across Africa
            <br />
            <span className="text-brand-300">buy and sell near you, protected by Safe pay</span>
          </h1>
          {own ? (
            <Link href={`/${own.country.toLowerCase()}`} className="flex h-12 items-center gap-2.5 rounded-2xl bg-white px-4 font-bold text-navy-900 sm:max-w-sm">
              <Flag country={own.country} /> Continue to {own.name}
              <ArrowRight className="ml-auto size-5" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </section>
      <div className="mx-auto grid max-w-[1400px] gap-8 px-4 sm:px-6 lg:px-8 pt-5">
        <section aria-labelledby="countries">
          <h2 id="countries" className="mb-3 text-base font-bold">
            Choose your country
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {all.data.map(market => (
              <li key={market.country}>
                <Link href={`/${market.country.toLowerCase()}`} className="flex items-center gap-3 rounded-2xl border border-navy-200 bg-white p-3.5 hover:border-navy-400">
                  <Flag country={market.country} className="h-6 w-9" />
                  <span className="grid">
                    <strong>{market.name}</strong>
                    <span className="text-xs text-navy-600">{market.listings.toLocaleString("en-GB")} listings</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        {showcase.ok ? (
          <>
            <section aria-labelledby="categories">
              <h2 id="categories" className="mb-3 text-base font-bold">
                Categories
              </h2>
              <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-6 lg:grid-cols-8">
                {showcase.data.categories.map(category => (
                  <Link key={category.slug} href={`/c/${category.slug}`} className="flex flex-col items-center gap-1.5 rounded-2xl border border-navy-200 bg-white px-1 py-2.5 text-center text-xs font-semibold hover:border-navy-400">
                    <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
                      <ShopIcon name={category.icon} className="size-5.5" />
                    </span>
                    <span className="line-clamp-2">{category.name}</span>
                  </Link>
                ))}
              </div>
            </section>
            {showcase.data.trending.length ? (
              <section aria-labelledby="trending">
                <h2 id="trending" className="mb-3 text-base font-bold">
                  Trending across countries
                </h2>
                <ListingGrid cards={showcase.data.trending} />
              </section>
            ) : null}
            <section aria-labelledby="recent">
              <h2 id="recent" className="mb-3 text-base font-bold">
                Just listed
              </h2>
              <ListingGrid cards={showcase.data.recent} />
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}
