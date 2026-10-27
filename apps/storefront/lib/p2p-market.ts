import type { StoreP2pAd } from "@bitocard/api-client/storefront";

/** Where the P2P market lives: the Crypto tab's first screen. */
export const marketPath = "/account/crypto";

/** A trader counted as experienced: at least this many completed trades. */
export const experiencedTrades = 10;

export type MarketView = "grid" | "list";
export type MarketSort = "price" | "trades";

/** What the market's filters say, read from the address (so every filter is a link or a GET form, and shareable). */
export type MarketState = {
  side: "buy" | "sell";
  asset: string;
  currency: string;
  /** The amount the customer wants to trade, in whole units of the currency as typed ("" when none). */
  amount: string;
  q: string;
  experienced: boolean;
  sort: MarketSort;
  view: MarketView;
};

type Search = Partial<Record<keyof MarketState, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** An amount as typed, kept only when it is a positive number with at most two decimal places. */
export function cleanAmount(raw: string) {
  const value = raw.replace(/[,\s]/g, "");
  return /^\d{1,12}(\.\d{1,2})?$/.test(value) && Number(value) > 0 ? value : "";
}

/** The amount in minor units for the API's `fiat` filter (null when none was typed). */
export const amountMinor = (amount: string) => (amount ? Math.round(Number(amount) * 100) : null);

/** Reads the market's filters, falling back to what is open: the first tradable coin, the local currency. */
export function marketState(search: Search, assets: string[], localCurrency: string): MarketState {
  const asked = first(search.asset).toUpperCase();
  return {
    side: first(search.side) === "sell" ? "sell" : "buy",
    asset: assets.includes(asked) ? asked : (assets[0] ?? "USDT"),
    currency: first(search.currency).toUpperCase() === "USD" ? "USD" : localCurrency,
    amount: cleanAmount(first(search.amount)),
    q: first(search.q).trim().slice(0, 80),
    experienced: first(search.experienced) === "1",
    sort: first(search.sort) === "trades" ? "trades" : "price",
    view: first(search.view) === "list" ? "list" : "grid",
  };
}

/** The market with some filters changed; defaults are left out, so links stay short. */
export function marketHref(state: MarketState, change: Partial<MarketState> = {}) {
  const next = { ...state, ...change };
  const params = new URLSearchParams({ side: next.side, asset: next.asset, currency: next.currency });
  if (next.amount) params.set("amount", next.amount);
  if (next.q) params.set("q", next.q);
  if (next.experienced) params.set("experienced", "1");
  if (next.sort !== "price") params.set("sort", next.sort);
  if (next.view !== "grid") params.set("view", next.view);
  return `${marketPath}?${params.toString()}`;
}

/** The API's query for the order book (it filters the coin, side, currency, trader and amount itself). */
export function marketQuery(state: MarketState) {
  const minor = amountMinor(state.amount);
  return new URLSearchParams({ asset: state.asset, side: state.side, currency: state.currency, ...(state.q ? { q: state.q } : {}), ...(minor ? { fiat: String(minor) } : {}) }).toString();
}

/**
 * The filters the API leaves to the page: experienced traders only, and the order. "Best price" keeps the book's own
 * order (to buy, the cheapest first; to sell, the best paying first); "most trades" puts busy traders first, the best
 * price first between equals.
 */
export function shownAds(ads: StoreP2pAd[], state: MarketState) {
  const kept = state.experienced ? ads.filter(ad => ad.trader.trades_total >= experiencedTrades) : ads;
  if (state.sort === "price") return kept;
  return kept.map((ad, index) => ({ ad, index })).sort((a, b) => b.ad.trader.trades_total - a.ad.trader.trades_total || a.index - b.index).map(item => item.ad);
}
