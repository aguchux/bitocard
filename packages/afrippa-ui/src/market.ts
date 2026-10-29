import type { StoreP2pAd } from "@bitocard/api-client/storefront";

/** A trader counted as experienced: at least this many completed trades. */
export const experiencedTrades = 10;

/** The global market's code: one book per coin in US dollars, across countries. */
export const globalMarket = "WW";

export type MarketView = "grid" | "list";
export type MarketSort = "price" | "trades";

/** A market a customer may trade in (`GET /v1/afrippa/p2p/markets`), or one Afrippa shows (`GET /v1/afrippa/markets`). */
export type MarketChoice = { market: string; name: string; currencies: string[]; home?: boolean };

/** What the market's filters say, read from the address (so every filter is a link or a GET form, and shareable). */
export type MarketState = {
  /** The page the market is on: links and the filters' form go here. */
  path: string;
  /** The market chosen in the address (`?market=`), "" for the page's own (the customer's home market, or the market in the path). */
  market: string;
  side: "buy" | "sell";
  asset: string;
  currency: string;
  /** The amount the customer wants to trade, in whole units of the currency as typed ("" when none). */
  amount: string;
  q: string;
  experienced: boolean;
  /** Merchants' ads only (the API filters them). */
  merchant: boolean;
  sort: MarketSort;
  view: MarketView;
};

type Search = Partial<Record<Exclude<keyof MarketState, "path">, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** An amount as typed, kept only when it is a positive number with at most two decimal places. */
export function cleanAmount(raw: string) {
  const value = raw.replace(/[,\s]/g, "");
  return /^\d{1,12}(\.\d{1,2})?$/.test(value) && Number(value) > 0 ? value : "";
}

/** The amount in minor units for the API's `fiat` filter (null when none was typed). */
export const amountMinor = (amount: string) => (amount ? Math.round(Number(amount) * 100) : null);

export type MarketOptions = {
  /** The page the market is on. */
  path: string;
  /**
   * The markets that may be chosen with `?market=` (the customer's own first, marked `home`); without them, the page's
   * own market only. A market that is not listed falls back to the page's own: the home market, else the first listed.
   */
  markets?: MarketChoice[];
};

/**
 * Reads the market's filters, falling back to what is open: the page's own market, the first tradable coin, and the
 * market's first currency (the local currency; or US dollars where the market trades in them only).
 */
export function marketState(search: Search, assets: string[], localCurrency: string, options: MarketOptions): MarketState {
  const asked = first(search.asset).toUpperCase();
  // The page's own market: the customer's home, else (their own market closed) the first they may trade in.
  const own = options.markets ? (options.markets.find(item => item.home) ?? options.markets[0]) : undefined;
  const choice = options.markets?.find(item => !item.home && item.market === first(search.market).toUpperCase()) ?? (own && !own.home ? own : undefined);
  const currencies = (choice ?? own)?.currencies ?? [...new Set([localCurrency, "USD"])];
  const askedCurrency = first(search.currency).toUpperCase();
  return {
    path: options.path,
    market: choice?.market ?? "",
    side: first(search.side) === "sell" ? "sell" : "buy",
    asset: assets.includes(asked) ? asked : (assets[0] ?? "USDT"),
    currency: currencies.includes(askedCurrency) ? askedCurrency : (currencies[0] ?? localCurrency),
    amount: cleanAmount(first(search.amount)),
    q: first(search.q).trim().slice(0, 80),
    experienced: first(search.experienced) === "1",
    merchant: first(search.merchant) === "1",
    sort: first(search.sort) === "trades" ? "trades" : "price",
    view: first(search.view) === "list" ? "list" : "grid",
  };
}

/** The market with some filters changed; defaults are left out, so links stay short. */
export function marketHref(state: MarketState, change: Partial<MarketState> = {}) {
  const next = { ...state, ...change };
  const params = new URLSearchParams({ ...(next.market ? { market: next.market } : {}), side: next.side, asset: next.asset, currency: next.currency });
  if (next.amount) params.set("amount", next.amount);
  if (next.q) params.set("q", next.q);
  if (next.experienced) params.set("experienced", "1");
  if (next.merchant) params.set("merchant", "1");
  if (next.sort !== "price") params.set("sort", next.sort);
  if (next.view !== "grid") params.set("view", next.view);
  return `${next.path}?${params.toString()}`;
}

/** The API's query for the order book (it filters the market, coin, side, currency, trader, merchants and amount itself). */
export function marketQuery(state: MarketState) {
  const minor = amountMinor(state.amount);
  return new URLSearchParams({
    ...(state.market ? { market: state.market } : {}),
    asset: state.asset,
    side: state.side,
    currency: state.currency,
    ...(state.q ? { q: state.q } : {}),
    ...(minor ? { fiat: String(minor) } : {}),
    ...(state.merchant ? { merchant: "true" } : {}),
  }).toString();
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
