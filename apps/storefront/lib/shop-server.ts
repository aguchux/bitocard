import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { ShopAssistantProfile, ShopCategoryCovers, ShopMarkets, ShopResaleAvailability, ShopState, ShopTopCategory } from "@bitocard/api-client/classifieds";
import { appUrl } from "@bitocard/ui/site";
import { apiUrl } from "./api";
import { currentCustomer, customerApi } from "./customer";
import { onHouseSite } from "./handoff";

/** BitoCard Shop's public site (`SHOP_URL`), where every listing has its one public address. */
export const shopOrigin = () => new URL(appUrl("shop")).origin;

/** The countries BitoCard Shop is open in (public, cached a minute; empty while the API cannot be reached). */
export const shopMarkets = cache(async (): Promise<ShopMarkets["data"]> => {
  try {
    const res = await fetch(apiUrl("/v1/classifieds/markets"), { next: { revalidate: 60, tags: ["store"] } });
    return res.ok ? ((await res.json()) as ShopMarkets).data : [];
  } catch {
    return [];
  }
});

/**
 * Whether the customer gets the Shop tab: on BitoCard's own sites only (never a reseller's store or domain), with a
 * country where BitoCard Shop is open. Returns that market, or null.
 */
export async function shopMarketFor(customer: { country: string | null } | null) {
  if (!customer?.country || !(await onHouseSite())) return null;
  return (await shopMarkets()).find(market => market.country === customer.country) ?? null;
}

/**
 * BitoCard Shop's band on the home page: the market's categories, each with a random live listing's photo (a new pick
 * about every minute), on BitoCard's own sites only (root and every country store), wherever the Shop is open in the
 * shopper's market, listings or not (a category with none invites the first seller). Null otherwise, and while the API
 * cannot be reached.
 */
export async function shopBandFor(country: string | null) {
  if (!country || !(await onHouseSite())) return null;
  const market = (await shopMarkets()).find(item => item.country === country);
  if (!market) return null;
  try {
    const res = await fetch(apiUrl(`/v1/classifieds/category-covers?country=${encodeURIComponent(country)}`), { next: { revalidate: 60, tags: ["store"] } });
    if (!res.ok) return null;
    const covers = (await res.json()) as ShopCategoryCovers;
    return covers.data.length ? { market, categories: covers.data } : null;
  } catch {
    return null;
  }
}

/**
 * BitoCard Shop in the header's menu: on BitoCard's own sites, while the Shop is open somewhere. It opens the shopper's
 * market where the Shop is open there, BitoCard Shop's home when they have not chosen one, and nothing where their
 * market has no Shop yet. Signed in, through the sign-in handoff; signed out, straight there.
 */
export async function shopNavHref(market: string | null, signedIn: boolean) {
  if (!(await onHouseSite())) return null;
  const markets = await shopMarkets();
  if (!markets.length) return null;
  const open = market ? markets.find(item => item.country === market) : null;
  if (market && !open) return null;
  const path = open ? `/${open.country.toLowerCase()}` : "/";
  return signedIn ? shopHref(path) : `${shopOrigin()}${path}`;
}

/** A page on shop.bitocard.com, reached through the sign-in handoff so the customer arrives signed in there too. */
export function shopHref(path: string) {
  return `/handoff/go?to=${encodeURIComponent(shopOrigin())}&next=${encodeURIComponent(path)}`;
}

/**
 * A listing's public page from the API's address (`https://shop.bitocard.com/ng/l/100001-tv`), through the handoff to
 * this site's own BitoCard Shop (its path is what matters: local development has its own); null for anything else.
 */
export function shopListingHref(url: string | null) {
  if (!url) return null;
  try {
    const { pathname } = new URL(url);
    return /^\/[a-z]{2}\/l\/\d+(?:-[a-z0-9-]*)?$/.test(pathname) ? shopHref(pathname) : null;
  } catch {
    return null;
  }
}

/**
 * Every Shop tab page: the signed-in customer with a confirmed email and their BitoCard Shop market. Signed out, to
 * sign in and back to `path`; an unconfirmed email to its code first; where BitoCard Shop is not open for them (a
 * reseller's store, their country not open), not found. Pages render alongside the layout, so each checks for itself.
 */
export async function requireShop(path: string) {
  const customer = await currentCustomer();
  if (!customer) redirect(`/signin?next=${encodeURIComponent(path)}`);
  if (!customer.email_verified) redirect(`/account/verify?next=${encodeURIComponent(path)}`);
  const market = await shopMarketFor(customer);
  if (!market) notFound();
  const unread = await customerApi<{ unread: number }>("GET", "/v1/classifieds/conversations/unread");
  return { customer, market, shop: { browse: shopHref(`/${market.country.toLowerCase()}`), unread: unread.ok ? unread.data.unread : 0 } };
}

/**
 * The shop assistant that helps sellers in this country (Fill from photos, Suggest a price, Improve, Suggest a reply), or
 * null where none does: `classifieds_assistant` off, no active assistant, or its roles leave sellers out.
 */
export const shopAssistant = cache(async (country: string): Promise<{ name: string } | null> => {
  const result = await customerApi<ShopAssistantProfile>("GET", `/v1/classifieds/assistant?country=${encodeURIComponent(country)}&surface=sell`);
  const assistant = result.ok ? result.data.assistant : null;
  return assistant?.roles.includes("sell") ? { name: assistant.name } : null;
});

/** Whether the signed-in seller can open listings to resellers, and BitoCard's limits there (null: not known). */
export async function shopResale(): Promise<ShopResaleAvailability | null> {
  const result = await customerApi<ShopResaleAvailability>("GET", "/v1/classifieds/me/resale");
  return result.ok ? result.data : null;
}

async function publicList<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(apiUrl(path), { next: { revalidate: 300, tags: ["store"] } });
    return res.ok ? ((await res.json()) as { data: T[] }).data : [];
  } catch {
    return [];
  }
}

/** The market's categories (with their suggested features) and its states and areas, for the Post an ad form. */
export const shopReference = cache(async (country: string) => {
  const [categories, states] = await Promise.all([
    publicList<ShopTopCategory>(`/v1/classifieds/categories?country=${encodeURIComponent(country)}`),
    publicList<ShopState>(`/v1/classifieds/areas?country=${encodeURIComponent(country)}`),
  ]);
  return { categories, states };
});
