import type { Metadata } from "next";
import { appUrl } from "@bitocard/ui/site";

/**
 * SHQ is private: every page is `noindex` (the root layout) except its public doors, the reseller sign-up and
 * sign-in, which search engines may show to people looking to sell gift cards, airtime and data under their brand.
 * Keep this list in step with robots.txt and the sitemap.
 */
export const publicPaths = ["/signup", "/signin"] as const;

/** SHQ's own address (https://shq.bitocard.com in production), never a Vercel deployment's. */
export const shqOrigin = () => new URL(appUrl("shq"));

/** The share card drawn by app/opengraph-image.tsx. */
const shareImage = { url: "/opengraph-image", width: 1200, height: 630, alt: "BitoCard SHQ – open your own digital store for gift cards, airtime and data" };

/** Metadata for one of SHQ's public pages: indexable, canonical, with Open Graph and Twitter cards. */
export function publicPageMetadata({ path, title, description }: { path: (typeof publicPaths)[number]; title: string; description: string }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
    // Named here: a page's own openGraph replaces the inherited one, which would drop app/opengraph-image.
    openGraph: { type: "website", url: path, siteName: "BitoCard SHQ", locale: "en_GB", title: `${title} | BitoCard SHQ`, description, images: [shareImage] },
    twitter: { card: "summary_large_image", title: `${title} | BitoCard SHQ`, description, images: [shareImage.url] },
  };
}
