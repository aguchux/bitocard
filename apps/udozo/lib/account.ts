import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { ShopAssistantProfile, ShopResaleAvailability, ShopState, ShopTopCategory } from "@bitocard/api-client/classifieds";
import type { PlaceCounts } from "./account-places";
import { apiUrl, markets } from "./api";
import { type Customer, currentCustomer, customerApi, signInPath } from "./customer";

/** The badges for the account's places, or nothing to show while the API cannot be reached. */
export async function accountCounts(): Promise<PlaceCounts> {
  const result = await customerApi<{ unread: number; resellers?: number; resellers_waiting?: number }>("GET", "/v1/classifieds/conversations/unread");
  return result.ok ? { unread: result.data.unread, resellers: { count: result.data.resellers ?? 0, waiting: result.data.resellers_waiting ?? 0 } } : { unread: 0, resellers: { count: 0, waiting: 0 } };
}

/** The customer's own market (their fixed country), where Udozo is open there; null otherwise. */
export async function marketOf(customer: Pick<Customer, "country"> | null) {
  if (!customer?.country) return null;
  return (await markets()).data.find(market => market.country === customer.country) ?? null;
}

/**
 * The signed-in customer with a confirmed email, on every account page. Signed out, to sign in and back to `path`; an
 * unconfirmed email to its code first. Pages render alongside the layout, so each checks for itself.
 */
export async function requireCustomer(path: string) {
  const customer = await currentCustomer();
  if (!customer) redirect(signInPath(path));
  if (!customer.email_verified) redirect(`/verify?next=${encodeURIComponent(path)}`);
  return customer;
}

/**
 * Every selling page (listings, messages, orders, Safe pay, payouts): the customer as `requireCustomer`, and their
 * market. Udozo not open in their country: not found, as there is nothing to sell into.
 */
export async function requireSeller(path: string) {
  const customer = await requireCustomer(path);
  const market = await marketOf(customer);
  if (!market) notFound();
  return { customer, market };
}

/** A listing's public page from the API's address (`https://udozo.com/ng/l/100001-tv`): its path on this site; null for anything else. */
export function listingHref(url: string | null) {
  if (!url) return null;
  try {
    const { pathname } = new URL(url);
    return /^\/[a-z]{2}\/l\/\d+(?:-[a-z0-9-]*)?$/.test(pathname) ? pathname : null;
  } catch {
    return null;
  }
}

/**
 * The shop assistant that helps sellers in this country (Fill from photos, Suggest a price, Improve, Suggest a reply), or
 * null where none does: `classifieds_assistant` off, no active assistant, or its roles leave sellers out.
 */
export const sellerAssistant = cache(async (country: string): Promise<{ name: string } | null> => {
  const result = await customerApi<ShopAssistantProfile>("GET", `/v1/classifieds/assistant?country=${encodeURIComponent(country)}&surface=sell`);
  const assistant = result.ok ? result.data.assistant : null;
  return assistant?.roles.includes("sell") ? { name: assistant.name } : null;
});

/** Whether the signed-in seller can open listings to resellers, and Udozo's limits there (null: not known). */
export async function resaleAvailability(): Promise<ShopResaleAvailability | null> {
  const result = await customerApi<ShopResaleAvailability>("GET", "/v1/classifieds/me/resale");
  return result.ok ? result.data : null;
}

async function publicList<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(apiUrl(path), { next: { revalidate: 300, tags: ["shop"] } });
    return res.ok ? ((await res.json()) as { data: T[] }).data : [];
  } catch {
    return [];
  }
}

/** The market's categories (with their suggested features) and its states and areas, for the Post an ad form. */
export const sellReference = cache(async (country: string) => {
  const [categories, states] = await Promise.all([
    publicList<ShopTopCategory>(`/v1/classifieds/categories?country=${encodeURIComponent(country)}`),
    publicList<ShopState>(`/v1/classifieds/areas?country=${encodeURIComponent(country)}`),
  ]);
  return { categories, states };
});
