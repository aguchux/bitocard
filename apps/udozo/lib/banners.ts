import "server-only";
import { query, shopApi } from "./api";

/** The places on udozo.com Udozo's team can put a banner ad (the API's `bannerPositions`). */
export type BannerPosition = "account_rail" | "dashboard_top" | "dashboard_side" | "dashboard_main";
export type SiteBanner = { object: "banner"; id: string; image_url: string; href: string; alt: string };

/**
 * The banner ads showing in a place for a market (its own, else those for every market), read from Udozo's API and kept
 * a minute. Empty while there are none or the API cannot answer: the place then shows nothing.
 */
export async function bannersFor(position: BannerPosition, country: string | null): Promise<SiteBanner[]> {
  const result = await shopApi<{ data: SiteBanner[] }>(`/v1/classifieds/banners${query({ position, country })}`);
  return result.ok && Array.isArray(result.data?.data) ? result.data.data.filter(banner => safeBannerHref(banner.href) !== null && /^https:\/\//.test(banner.image_url)) : [];
}

/** One of them, a different one from visit to visit, so banners sharing a place take turns. */
export function pickBanner(banners: SiteBanner[], random = Math.random): SiteBanner | null {
  return banners.length ? (banners[Math.floor(random() * banners.length)] ?? banners[0]!) : null;
}

/** A banner's link as the page uses it: a page here, or an https address elsewhere (opened in a new tab). */
export function safeBannerHref(href: string): { href: string; external: boolean } | null {
  if (href.startsWith("/") && !href.startsWith("//") && !href.includes("\\")) return { href, external: false };
  try {
    return new URL(href).protocol === "https:" ? { href, external: true } : null;
  } catch {
    return null;
  }
}
