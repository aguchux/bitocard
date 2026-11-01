import "server-only";
import { cookies } from "next/headers";
import { type MarketChoice, marketCookie, readMarketChoice } from "./market-choice";

/** The shopper's remembered choice of country (`udz_market`), or null when they never chose. */
export async function currentMarketChoice(): Promise<MarketChoice> {
  return readMarketChoice((await cookies()).get(marketCookie)?.value);
}
