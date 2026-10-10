import "server-only";
import { cookies } from "next/headers";
import { currentCustomer } from "./customer";
import { storeSubdomain } from "./store";

/** The shopper's market, chosen in the market dialog: a 2-letter country code, or `global` for the whole store. */
export const marketCookie = "bc_market";

/**
 * The market: a signed-in customer's own country (chosen at sign-up and fixed), else the one from the cookie, or null
 * before the shopper has chosen (the dialog then asks). A reseller's store sells in its own country only, so it has no
 * market to choose (`global`: the API keeps it to the store's country).
 */
export async function currentMarket(): Promise<string | null> {
  if (await storeSubdomain()) return "global";
  const customer = await currentCustomer();
  if (customer?.country) return customer.country;
  const value = (await cookies()).get(marketCookie)?.value ?? "";
  if (value === "global") return "global";
  return /^[A-Z]{2}$/.test(value) ? value : null;
}

/** Whether the market is fixed by the signed-in customer's account (no market to choose). */
export async function marketLocked() {
  return !(await storeSubdomain()) && Boolean((await currentCustomer())?.country);
}

const add = (path: string, name: string, value: string) => `${path}${path.includes("?") ? "&" : "?"}${name}=${encodeURIComponent(value)}`;

/** Store reads that list products: these take the customer's currency for local prices. */
const priced = /^\/v1\/store\/(products|home|search)(\/|\?|$)/;

/** A product read with the signed-in customer's currency, so each product carries its values in it (`price`). */
export async function withPrices(path: string) {
  const currency = (await currentCustomer())?.currency;
  return currency && priced.test(path) ? add(path, "currency", currency) : path;
}

/** A store API path with the shopper's market (other countries' local products left out) and, signed in, their currency. */
export async function inMarket(path: string) {
  const market = await currentMarket();
  return withPrices(market && market !== "global" ? add(path, "market", market) : path);
}
