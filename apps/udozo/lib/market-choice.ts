/**
 * The country a shopper chose in the header's country menu, remembered so they need not choose it on every visit: a
 * country's code, or `all` for All countries. Kept in this site's own `udz_market` cookie (host-only, httpOnly,
 * `SameSite=Lax`, a year), set only when they choose (`/market/<choice>`, `app/market/[choice]/route.ts`); strictly
 * necessary, as it is set at their request (in the cookie notice). With a country chosen, udozo.com's home is that
 * country's market; with All countries, the showcase across them.
 */
export const marketCookie = "udz_market";
export const marketCookieMaxAge = 60 * 60 * 24 * 365;

/** What the shopper chose: a country's code (upper case), `all`, or nothing. */
export type MarketChoice = string | "all" | null;

/** The cookie's value read safely: two letters, or `all`; anything else is no choice. */
export function readMarketChoice(value: string | undefined | null): MarketChoice {
  if (!value) return null;
  if (value === "all") return "all";
  return /^[a-z]{2}$/i.test(value) ? value.toUpperCase() : null;
}

/** Where choosing in the country menu goes: through `/market/<choice>`, which remembers it, then on to that market. */
export const chooseMarketHref = (country: string | null) => `/market/${country ? country.toLowerCase() : "all"}`;

/** The chosen country, only while it is one of the open markets (a closed one, or All countries, is none). */
export function chosenOpenMarket<T extends { country: string }>(choice: MarketChoice, open: T[]): T | null {
  if (!choice || choice === "all") return null;
  return open.find(market => market.country === choice) ?? null;
}
