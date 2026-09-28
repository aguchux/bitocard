import type { Metadata } from "next";
import { appUrl, brand } from "@bitocard/ui/site";
import { organizationId } from "@bitocard/ui/seo";
import { legalUpdatedIso } from "@bitocard/ui/legal";

export const siteName = "BitoCard Legals & Compliance";

type PageSeo = { title: string; description: string; path: string };

/** Per-page metadata: canonical URL plus matching Open Graph and Twitter title/description. */
export function pageMetadata({ title, description, path }: PageSeo): Metadata {
  // A page-level openGraph object replaces the inherited one, so point at the site's generated image explicitly.
  const image = { url: "/opengraph-image", width: 1200, height: 630, alt: `${title} – ${siteName}` };
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "article", url: path, siteName, title: `${title} | ${brand.name}`, description, locale: "en_GB", modifiedTime: legalUpdatedIso, images: [image] },
    twitter: { card: "summary_large_image", title: `${title} | ${brand.name}`, description, images: [image] },
  };
}

/** Breadcrumb trail from the URL path: Home › Documents › Privacy notice. */
export function breadcrumbSchema({ title, path }: PageSeo) {
  const url = appUrl("legals", path);
  const trail = [{ name: "Legals & Compliance", item: appUrl("legals") }];
  if (path.startsWith("/documents/")) trail.push({ name: "Documents", item: appUrl("legals", "/documents") });
  trail.push({ name: title, item: url });
  return { "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`, itemListElement: trail.map((step, index) => ({ "@type": "ListItem", position: index + 1, ...step })) };
}

/** WebPage + breadcrumb structured data for a legal document. */
export function documentSchema(seo: PageSeo) {
  const url = appUrl("legals", seo.path);
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": url, url, name: seo.title, description: seo.description, inLanguage: "en-GB", dateModified: legalUpdatedIso, isPartOf: { "@id": `${appUrl("legals")}#website` }, publisher: { "@id": organizationId() }, breadcrumb: { "@id": `${url}#breadcrumb` } },
      breadcrumbSchema(seo),
    ],
  };
}
