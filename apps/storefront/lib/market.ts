import "server-only";
import { cookies } from "next/headers";
import { currentCustomer } from "./customer";
import { storeSubdomain } from "./store";

/** The shopper's market, chosen in the market dialog: a 2-letter country code, or `global` for the whole store. */
export const marketCookie = "bc_market";

/**
 * The market whose products bitocard.com shows. On a reseller's hosted store, `global` (the API keeps it to the store's
 * own country, so there is no market to choose). On bitocard.com, the one store (country stores are retired,
 * docs/BITOCARD_MULTI_WALLETS_PLAN.md): the market the shopper chose (a country, or `global`), signed in or not; else a
 * signed-in customer's own country; else null (the dialog then asks). Choosing never takes anyone elsewhere.
 */
export async function currentMarket(): Promise<string | null> {
  if (await storeSubdomain()) return "global";
  const value = (await cookies()).get(marketCookie)?.value ?? "";
  if (value === "global") return "global";
  if (/^[A-Z]{2}$/.test(value)) return value;
  return (await currentCustomer())?.country ?? null;
}

/** Whether the market is fixed, with nothing to choose: a reseller's store (its own country). */
export async function marketLocked() {
  return Boolean(await storeSubdomain());
}

/** Whether the shopper is browsing root bitocard.com in US dollars (chose to stay global), not their account's country. */
export async function marketIsGlobal() {
  if (await storeSubdomain()) return false;
  return ((await cookies()).get(marketCookie)?.value ?? "") === "global";
}

const add = (path: string, name: string, value: string) => `${path}${path.includes("?") ? "&" : "?"}${name}=${encodeURIComponent(value)}`;

/** Store reads that list products: these take a currency for local prices. */
const priced = /^\/v1\/store\/(products|home|search)(\/|\?|$)/;

/**
 * The currency products are shown in on bitocard.com: a signed-in customer's own country's (their home wallet), unless
 * they chose to stay global; US dollars for that and for every signed-out shopper. Every customer also holds a US dollar
 * wallet and may hold others: checkout shows the price in each. A reseller's store shows its own currency.
 */
async function priceCurrency(): Promise<string | undefined> {
  if (await storeSubdomain()) return undefined;
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
