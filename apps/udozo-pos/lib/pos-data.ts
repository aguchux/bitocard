import "server-only";
import { cache } from "react";
import type { PosApps, PosCharge, PosOwner, PosPlans } from "./pos";
import { type ApiResult, customerApi } from "./session";
import { apiUrl } from "./site";

/** A public read, kept a minute; never throws (null when the API cannot answer). */
async function publicRead<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(apiUrl(path), { headers: { accept: "application/json" }, next: { revalidate: 60 } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The plans as a market sees them (priced in its currency), or unpriced without one. */
export const publicPlans = (country?: string | null) => publicRead<PosPlans>(`/v1/pos/plans${country && /^[A-Z]{2}$/.test(country) ? `?country=${country}` : ""}`);

/**
 * Which market's prices the public pages show: the signed-in owner's own country (fixed on their account), else the
 * `?country=` asked for, else Nigeria, Udozo's first market.
 */
export function marketFor(customerCountry: string | null | undefined, asked?: string | string[]) {
  const query = typeof asked === "string" ? asked.toUpperCase() : "";
  return customerCountry ?? (/^[A-Z]{2}$/.test(query) ? query : "NG");
}

/** Where each app's button goes; every one Coming soon when the API cannot say. */
export async function posApps(): Promise<PosApps> {
  return (await publicRead<PosApps>("/v1/pos/apps")) ?? { object: "pos_apps", android: null, ios: null, windows: null };
}

/** The signed-in owner's place: POS open in their country, their wallet, the plans and their account (or none yet). */
export const currentOwner = cache((): Promise<ApiResult<PosOwner>> => customerApi<PosOwner>("GET", "/v1/pos/owner"));

/** Every charge for the plan, newest first. */
export const ownerCharges = () => customerApi<{ object: "list"; data: PosCharge[] }>("GET", "/v1/pos/owner/charges");
