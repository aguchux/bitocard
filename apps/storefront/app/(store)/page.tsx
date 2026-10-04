import { redirect } from "next/navigation";
import type { StoreHome } from "@bitocard/api-client/storefront";
import { JsonLd, organizationId, organizationSchema } from "@bitocard/ui/seo";
import { appUrl, brand } from "@bitocard/ui/site";
import { HomeSections } from "@/components/store/sections";
import { storeApi } from "@/lib/api";

export const revalidate = 60;

/** The home page as admins laid it out in the Storefront Manager. Until it is published, visitors see /resellers. */
export default async function Home() {
  const home = await storeApi<StoreHome>("/v1/store/home");
  if (!home.ok) redirect("/resellers");
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
      <HomeSections sections={home.data.sections} groups={home.data.navigation} countries={home.data.countries} />
    </>
  );
}
