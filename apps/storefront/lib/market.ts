import "server-only";
import { cookies } from "next/headers";

/** The shopper's market, chosen in the market dialog: a 2-letter country code, or `global` for the whole store. */
export const marketCookie = "bc_market";

/** The market from the cookie, or null before the shopper has chosen (the dialog then asks). */
export async function currentMarket(): Promise<string | null> {
  const value = (await cookies()).get(marketCookie)?.value ?? "";
  if (value === "global") return "global";
  return /^[A-Z]{2}$/.test(value) ? value : null;
}

/** A store API path with the shopper's market, so other countries' local products are left out. */
export async function inMarket(path: string) {
  const market = await currentMarket();
  return market ? `${path}${path.includes("?") ? "&" : "?"}market=${market}` : path;
}
