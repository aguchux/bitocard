import type { Metadata } from "next";
import { Suspense } from "react";
import { JsonLd, organizationId, organizationSchema } from "@bitocard/ui/seo";
import { appUrl } from "@bitocard/ui/site";
import { AuthLayout } from "@/components/auth-layout";
import { publicPageMetadata } from "@/lib/seo";
import { SignUp } from "./sign-up";

const description =
  "Open your own BitoCard store and sell gift cards, airtime, data and bills under your own brand and prices. Store setup takes minutes; verification and funding your wallet may take longer.";

export const metadata: Metadata = publicPageMetadata({ path: "/signup", title: "Create your reseller account", description });

export default function SignUpPage() {
  const url = appUrl("shq", "/signup");
  return (
    <AuthLayout>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            organizationSchema(),
            {
              "@type": "WebApplication",
              "@id": `${appUrl("shq")}#app`,
              name: "BitoCard SHQ",
              alternateName: "Seller Head Quarters",
              url: appUrl("shq"),
              applicationCategory: "BusinessApplication",
              operatingSystem: "Web",
              publisher: { "@id": organizationId() },
            },
            {
              "@type": "WebPage",
              "@id": url,
              url,
              name: "Create your reseller account | BitoCard SHQ",
              description,
              inLanguage: "en-GB",
              isPartOf: { "@id": `${appUrl("shq")}#app` },
              publisher: { "@id": organizationId() },
              primaryImageOfPage: appUrl("shq", "/opengraph-image"),
            },
          ],
        }}
      />
      <Suspense>
        <SignUp termsUrl={appUrl("legals", "/documents/reseller-terms")} privacyUrl={appUrl("legals", "/documents/privacy")} />
      </Suspense>
    </AuthLayout>
  );
}
