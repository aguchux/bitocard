import type { ResolvedSection, StoreHome } from "@bitocard/api-client/storefront";
import { JsonLd, organizationId, organizationSchema } from "@bitocard/ui/seo";
import { appUrl, brand } from "@bitocard/ui/site";
import { HomeSections } from "@/components/store/sections";
import { storeApi } from "@/lib/api";

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
 * approved default layout, so bitocard.com is always the store; resellers find their page through its links.
 */
export default async function Home() {
  const home = await storeApi<StoreHome>("/v1/store/home");
  return (
    <>
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
      {home.ok ? <HomeSections sections={home.data.sections} groups={home.data.navigation} countries={home.data.countries} /> : <HomeSections sections={offline} groups={[]} countries={[]} />}
    </>
  );
}
