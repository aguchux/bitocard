import "server-only";
import { cache } from "react";
import type { PosApps, PosCatalogue, PosCharge, PosCollections, PosCollectionsOverview, PosCustomer, PosCustomers, PosOwner, PosPlans, PosSale, PosSales, PosSettlement, PosSettlements, PosShopKind } from "./pos";
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

/** The kinds of shop the till is tailored to (General shop alone when the API cannot say). */
export async function shopKinds(): Promise<PosShopKind[]> {
  return (await publicRead<{ data: PosShopKind[] }>("/v1/pos/shop-kinds"))?.data ?? [{ code: "general", name: "General shop", categories: [] }];
}

/** The signed-in owner's place: POS open in their country, their wallet, the plans and their account (or none yet). */
export const currentOwner = cache((): Promise<ApiResult<PosOwner>> => customerApi<PosOwner>("GET", "/v1/pos/owner"));

/** The listings ticked Sell at POS, read live from udozo.com (`query` from `catalogueQuery`). */
export const ownerCatalogue = (query = "") => customerApi<PosCatalogue>("GET", `/v1/pos/owner/catalogue${query}`);

/** How many products the till reads a call, and the most calls (20,000 products). */
export const tillPage = 1000;
const tillPages = 20;

/**
 * Every product at the till, read page by page (a shop is never cut off at one page), the summary and categories from
 * the first. Fails as the first page fails; a later page that fails stops there with what was read.
 */
export async function tillCatalogue(): Promise<ApiResult<PosCatalogue>> {
  const first = await ownerCatalogue(`?show=all&limit=${tillPage}&offset=0`);
  if (!first.ok) return first;
  const data = [...first.data.data];
  let more = first.data.has_more;
  for (let page = 1; more && page < tillPages; page += 1) {
    const next = await ownerCatalogue(`?show=all&limit=${tillPage}&offset=${page * tillPage}`);
    if (!next.ok) break;
    data.push(...next.data.data);
    more = next.data.has_more;
  }
  return { ok: true, data: { ...first.data, data, has_more: more } };
}

/** Every charge for the plan, newest first. */
export const ownerCharges = () => customerApi<{ object: "list"; data: PosCharge[] }>("GET", "/v1/pos/owner/charges");

/** The owner's sales, newest first, with the filter's takings (`query` from `salesQuery`). */
export const ownerSales = (query = "") => customerApi<PosSales>("GET", `/v1/pos/owner/sales${query}`);

/** One sale with its lines and payments. */
export const ownerSale = (id: string) => customerApi<PosSale>("GET", `/v1/pos/owner/sales/${id}`);

/** The shop's customers (`query` from `customersQuery`), and one with its sales and what it owes. */
export const ownerCustomers = (query = "") => customerApi<PosCustomers>("GET", `/v1/pos/owner/customers${query}`);
export const ownerCustomer = (id: string) => customerApi<PosCustomer>("GET", `/v1/pos/owner/customers/${id}`);

/** The owner's collection accounts: whether they may open one, where collections are paid, each till's account. */
export const ownerCollections = cache(() => customerApi<PosCollectionsOverview>("GET", "/v1/pos/owner/collections"));
/** Transfers into them, newest first (`status`: matched, unmatched or kept). */
export const ownerCollectionTransfers = (status?: string) => customerApi<PosCollections>("GET", `/v1/pos/owner/collections/transfers?limit=50${status && /^[a-z]+$/.test(status) ? `&status=${status}` : ""}`);
export const ownerSettlements = () => customerApi<PosSettlements>("GET", "/v1/pos/owner/collections/settlements?limit=30");
export const ownerSettlement = (id: string) => customerApi<PosSettlement>("GET", `/v1/pos/owner/collections/settlements/${id}`);
