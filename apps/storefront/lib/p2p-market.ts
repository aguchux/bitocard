import { marketState as read, type MarketChoice } from "@bitocard/crypto-ui/market";

export {
  amountMinor,
  cleanAmount,
  experiencedTrades,
  globalMarket,
  marketHref,
  marketQuery,
  shownAds,
  type MarketChoice,
  type MarketSort,
  type MarketState,
  type MarketView,
} from "@bitocard/crypto-ui/market";

/** Where the P2P market lives: the Crypto tab's first screen. */
export const marketPath = "/account/crypto";

/**
 * The market's filters on the Crypto tab (`@bitocard/crypto-ui`'s `marketState` on `marketPath`): `markets` are the
 * ones the customer may trade in, chosen with `?market=`; without them, their own market only.
 */
export const marketState = (search: Parameters<typeof read>[0], assets: string[], localCurrency: string, markets?: MarketChoice[]) =>
  read(search, assets, localCurrency, { path: marketPath, markets });
