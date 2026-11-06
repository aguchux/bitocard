/**
 * Where Sell was pressed on udozo.com (`/sell?from=<source>`), for the seller's posting journey in Udozo's admin
 * (Reports > Posting journeys). Kept in step with `sellSources` in Udozo's API.
 */
export const sellSources = ["header", "header_phone", "my_listings", "empty_state", "start_here", "invite", "pwa", "reseller", "username", "direct"] as const;
export type SellSource = (typeof sellSources)[number];

/** Post an ad, saying where Sell was pressed. */
export const sellHref = (source: SellSource) => `/sell?from=${source}`;

/** A `from` from the address, kept only when it is one of ours (else `direct`: typed or linked from elsewhere). */
export const cleanSellSource = (value: unknown): SellSource => (typeof value === "string" && (sellSources as readonly string[]).includes(value) ? (value as SellSource) : "direct");

/** Where Sell was pressed, read from a sign-in page's `next` (`/sell?from=header`); null when it is not Post an ad. */
export function sellSourceOf(next: string): SellSource | null {
  const url = new URL(next, "https://udozo.com");
  return url.pathname === "/sell" ? cleanSellSource(url.searchParams.get("from")) : null;
}
