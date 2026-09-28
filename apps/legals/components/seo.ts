import type { Metadata } from "next";
import { appUrl, brand } from "@bitocard/ui/site";
import { organizationId } from "@bitocard/ui/seo";
import { legalUpdatedIso } from "@bitocard/ui/legal";
import { ogFileName, ogImageSize, ogPages, type OgPath } from "@/components/og";

export const siteName = "BitoCard Legals & Compliance";

type PageSeo = { title: string; description: string; path: string };

/** URL of a page's banner image, served by app/og/[image]/route.tsx. */
export const ogImagePath = (path: string) => `/og/${ogFileName(path)}`;

/** Open Graph / Twitter image entry for a page, with its alt text. */
export function ogImage(path: string) {
  const alt = path in ogPages ? ogPages[path as OgPath].alt : siteName;
  return { url: ogImagePath(path), width: ogImageSize.width, height: ogImageSize.height, alt, type: "image/png" };
}

/** One language today; x-default tells search engines this is the version for everyone. */
export const languageAlternates = (path: string) => ({ "en-GB": path, "x-default": path });

/** Per-page metadata: canonical and language alternates, plus Open Graph and Twitter with the page's banner image. */
export function pageMetadata({ title, description, path }: PageSeo): Metadata {
  const image = ogImage(path);
  return {
    title,
    description,
    alternates: { canonical: path, languages: languageAlternates(path) },
    openGraph: { type: "article", url: path, siteName, title: `${title} | ${brand.name}`, description, locale: "en_GB", modifiedTime: legalUpdatedIso, section: "Legal", images: [image] },
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

/** Shared WebPage fields: language, freshness, site, publisher, image and breadcrumb. */
export function webPageFields({ title, description, path }: PageSeo) {
  const url = appUrl("legals", path);
  return {
    "@id": url, url, name: title, description, inLanguage: "en-GB", dateModified: legalUpdatedIso,
    isPartOf: { "@id": `${appUrl("legals")}#website` },
    publisher: { "@id": organizationId() },
    primaryImageOfPage: { "@type": "ImageObject", url: appUrl("legals", ogImagePath(path)), width: 1200, height: 630 },
    breadcrumb: { "@id": `${url}#breadcrumb` },
  };
}

/** WebPage + breadcrumb structured data for a legal document. */
export function documentSchema(seo: PageSeo) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", ...webPageFields(seo), about: { "@id": organizationId() }, genre: "Legal" },
      breadcrumbSchema(seo),
    ],
  };
}
