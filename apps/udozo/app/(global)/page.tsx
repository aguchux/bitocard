import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ShopShowcase } from "@bitocard/api-client/classifieds";
import type { ClassifiedHome } from "@bitocard/api-client/home";
import { HeroReel } from "@/components/home/hero-reel";
import { HomeSections } from "@/components/home/home-sections";
import { ListingGrid } from "@/components/listing-card";
import { type ApiResult, markets, shopApi } from "@/lib/api";
import { JsonLd } from "@/components/json-ld";
import { siteOrigin } from "@/lib/customer";
import { heroSlidesFor } from "@/lib/hero";
import { chosenOpenMarket } from "@/lib/market-choice";
import { currentMarketChoice } from "@/lib/market-choice-server";
import { organizationJsonLd, regionalAlternates, websiteJsonLd } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const all = await markets();
  return {
    title: { absolute: "Udozo across Africa: buy and sell near you" },
    description: `Buy and sell near you in ${all.data.map(market => market.name).join(", ") || "Africa"}, protected by Safe pay.`,
    alternates: { canonical: "/", languages: regionalAlternates(all.data, all.showcase, code => `/${code}`, "/") },
  };
}

/**
 * The home page. A shopper who chose a country in the header's menu (remembered in `udz_market`) goes straight to that
 * country's market, so they need not choose it again. Otherwise (All countries chosen, or nothing yet, as for search
 * engines) the global showcase, from the second country: recent and trending listings across the countries, never a
 * price, each saying its area and country, as Udozo's admins laid it out (Site › Home pages: the page across
 * countries); the plain showcase while the API cannot give it. With one country open, its market is the home page.
 */
export default async function GlobalHome() {
  const [all, choice] = await Promise.all([markets(), currentMarketChoice()]);
  const chosen = chosenOpenMarket(choice, all.data);
  if (chosen) redirect(`/${chosen.country.toLowerCase()}`);
  if (!all.showcase) {
    if (all.data.length === 1) redirect(`/${all.data[0]!.country.toLowerCase()}`);
    return (
      <div className="mx-auto grid max-w-md gap-3 px-4 py-16 text-center">
        <h1 className="text-2xl font-extrabold">Udozo is opening soon</h1>
        <p className="text-navy-600">Buy and sell near you, protected by Safe pay. Check back shortly.</p>
      </div>
    );
  }
  const [home, slides] = await Promise.all([shopApi<ClassifiedHome>("/v1/classifieds/home?page=global"), heroSlidesFor("global")]);
  return (
    <>
      <JsonLd data={organizationJsonLd(siteOrigin())} />
      <JsonLd data={websiteJsonLd(siteOrigin())} />
      {home.ok ? <HomeSections home={home.data} hero={slides.length ? <HeroReel slides={slides} title="Udozo: buy and sell near you" /> : undefined} /> : <DefaultGlobalHome showcase={await shopApi<ShopShowcase>("/v1/classifieds/showcase")} />}
    </>
  );
}

/** The plain showcase: trending and recent listings across the countries, never a price. */
function DefaultGlobalHome({ showcase }: { showcase: ApiResult<ShopShowcase> }) {
  return (
    <>
      <section className="bg-navy-900 pt-5 pb-6">
        <div className="mx-auto grid max-w-[1400px] px-4 sm:px-6 lg:px-8 gap-4">
          <h1 className="text-[22px] leading-tight font-extrabold text-white sm:text-3xl">
            Udozo across Africa
            <br />
            <span className="text-brand-300">buy and sell near you, protected by Safe pay</span>
          </h1>
        </div>
      </section>
      <div className="mx-auto grid max-w-[1400px] gap-8 px-4 sm:px-6 lg:px-8 pt-5">
        {showcase.ok ? (
          <>
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
