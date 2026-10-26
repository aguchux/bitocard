import type { ResolvedSection, StoreHome } from "@bitocard/api-client/storefront";
import { JsonLd, organizationId, organizationSchema } from "@bitocard/ui/seo";
import { appUrl, brand } from "@bitocard/ui/site";
import { HomeSections } from "@/components/store/sections";
import { ShopBand } from "@/components/store/shop-band";
import { storeApi } from "@/lib/api";
import { currentCustomer } from "@/lib/customer";
import { currentMarket, inMarket } from "@/lib/market";
import { shopBandFor, shopHref, shopOrigin } from "@/lib/shop-server";
import { currentStore } from "@/lib/store";

export const revalidate = 60;

/**
 * While the API cannot be reached: the hero with search, so the home page is still the store. Never a redirect;
 * the next revalidation brings the full page back.
 */
const offline: ResolvedSection[] = [
  {
    id: "offline-hero",
    type: "hero",
    span: { lg: 12, md: 6, rows: 1 },
    hidden: false,
    title: "One marketplace.",
    accent: "More ways to pay.",
    subtitle: "Shop gift cards, top up mobile, pay bills, and explore digital essentials.",
    search: true,
    categoryChips: false,
    data: { featured: [] },
  },
];

/**
 * The home page as admins laid it out in the Storefront Manager. Until a layout is published, the API serves the
 * approved default layout, so bitocard.com is always the store; resellers find their page through its links. On
 * BitoCard's own sites, where BitoCard Shop is open in the shopper's market, its categories slide under the hero.
 */
export default async function Home() {
  const [home, { store }, band, customer] = await Promise.all([
    inMarket("/v1/store/home").then(path => storeApi<StoreHome>(path)),
    currentStore(),
    currentMarket().then(shopBandFor),
    currentCustomer(),
  ]);
  const resellerStore = Boolean(store);
  // Signed in, through the sign-in handoff so they arrive signed in on the Shop too; signed out, straight there.
  const shopLink = (path: string) => (customer ? shopHref(path) : `${shopOrigin()}${path}`);
  const shopBand = band ? <ShopBand country={{ code: band.market.country, name: band.market.name }} categories={band.categories} href={shopLink} /> : null;
  return (
    <>
      {resellerStore ? null : (
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            organizationSchema(),
            {
              "@type": "WebSite",
              "@id": `${appUrl("storefront")}#website`,
              url: appUrl("storefront"),
              name: brand.name,
              inLanguage: "en-GB",
              publisher: { "@id": organizationId() },
              potentialAction: { "@type": "SearchAction", target: `${appUrl("storefront", "/search")}?q={search_term_string}`, "query-input": "required name=search_term_string" },
            },
          ],
        }}
      />
      )}
      {home.ok ? <HomeSections sections={home.data.sections} groups={home.data.navigation} countries={home.data.countries} design={store?.design} afterHero={shopBand} /> : <HomeSections sections={offline} groups={[]} countries={[]} design={store?.design} afterHero={shopBand} />}
    </>
  );
}
