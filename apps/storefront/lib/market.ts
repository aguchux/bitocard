import "server-only";
import { cookies } from "next/headers";
import { currentCustomer } from "./customer";
import { currentStore, storeSubdomain } from "./store";

/** The shopper's market, chosen in the market dialog: a 2-letter country code, or `global` for the whole store. */
export const marketCookie = "bc_market";

/**
 * The market: on a market's own country store (`ng.bitocard.com`…), always that store's own fixed country — never
 * `global`, never the cookie or the customer's own country, since the subdomain already fixes it and every shopper
 * there sees the same catalogue. On a reseller's hosted store, `global` (the API keeps it to the store's own country
 * regardless, so there is no market to choose). On root bitocard.com: a signed-in customer who explicitly chose to
 * stay global (the cookie) keeps browsing globally in US dollars even though their account has a fixed country;
 * otherwise their account's own country, else the cookie's choice, else null (the dialog then asks).
 */
export async function currentMarket(): Promise<string | null> {
  if (await storeSubdomain()) {
    const { store } = await currentStore();
    if (store?.house && store.country) return store.country;
    return "global";
  }
  const value = (await cookies()).get(marketCookie)?.value ?? "";
  if (value === "global") return "global";
  const customer = await currentCustomer();
  if (customer?.country) return customer.country;
  return /^[A-Z]{2}$/.test(value) ? value : null;
}

/** Whether the market is fixed, with nothing to choose: any subdomain (a market's own country store, or a reseller's). */
export async function marketLocked() {
  return Boolean(await storeSubdomain());
}

/** Whether the shopper is browsing root bitocard.com in US dollars (chose to stay global), not their account's country. */
export async function marketIsGlobal() {
  if (await storeSubdomain()) return false;
  return ((await cookies()).get(marketCookie)?.value ?? "") === "global";
}

/**
 * The live country store (`docs/BITOCARD_COUNTRY_STORES_PLAN.md`) for a market in a `countries` list, if any —
 * for root to redirect a signed-in customer (fixed country) or a chosen market into it, instead of staying on root.
 */
export function countryStoreFor(countries: ReadonlyArray<{ code: string; store_subdomain: string | null }>, code: string | null | undefined) {
  if (!code) return null;
  return countries.find(country => country.code === code)?.store_subdomain ?? null;
}

const add = (path: string, name: string, value: string) => `${path}${path.includes("?") ? "&" : "?"}${name}=${encodeURIComponent(value)}`;

/** Store reads that list products: these take a currency for local prices. */
const priced = /^\/v1\/store\/(products|home|search)(\/|\?|$)/;

/**
 * The currency products are shown in: sell as local as possible. On a market's own country store, that market's own
 * currency (its prices are the same for every shopper there). On root bitocard.com, a signed-in customer's own
 * account currency (their wallet) — unless they chose to stay global, in which case, and for every signed-out
 * shopper there with no market chosen yet, prices show in US dollars: every customer holds a US dollar wallet, and
 * checkout on bitocard.com in that case pays from it.
 */
async function priceCurrency(): Promise<string | undefined> {
  const subdomain = await storeSubdomain();
  if (subdomain) {
    const { store } = await currentStore();
    return store?.house ? (store.currency ?? undefined) : undefined;
  }
  if (await marketIsGlobal()) return "USD";
  const customer = await currentCustomer();
  return customer?.currency ?? "USD";
}

/** A product read priced for the shopper, so each product carries its values in it (`price`). */
export async function withPrices(path: string) {
  const currency = await priceCurrency();
  return currency && priced.test(path) ? add(path, "currency", currency) : path;
}

/** A store API path with the shopper's market (other countries' local products left out) and its prices. */
export async function inMarket(path: string) {
  const market = await currentMarket();
  return withPrices(market && market !== "global" ? add(path, "market", market) : path);
}
