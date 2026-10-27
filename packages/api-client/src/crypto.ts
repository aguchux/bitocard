import type { StoreP2pAd } from "./storefront";

/**
 * BitoCard Crypto's public data (`/v1/crypto`, no sign-in, cached for a minute): the markets shown, each market's book
 * and traders' cards. Nicknames only, never customers.
 */

/** A market shown on crypto.bitocard.com: the global market (`WW`, US dollars) or a country, with ads per currency. */
/** `install_prompt`: whether visitors are asked to install BitoCard Crypto as an app on this market's pages. */
export type CryptoMarket = { object: "crypto_market"; market: string; name: string; currencies: string[]; ads: Record<string, number>; install_prompt: boolean };

/** `GET /v1/crypto/markets`: the mode bitocard.com trades in, the coins on sale (in order) and the markets shown. */
export type CryptoMarkets = { object: "list"; mode: "live" | "test"; assets: string[]; data: CryptoMarket[] };

/** `GET /v1/crypto/markets/:market/ads`: a market's book for one coin, side and currency, as traders see it. */
export type CryptoBook = { object: "list"; market: string; asset: string; currency: string; side: "buy" | "sell"; data: StoreP2pAd[] };

/** `GET /v1/crypto/traders/:nickname`: a trader's public card. */
export type CryptoTrader = { object: "p2p_trader"; nickname: string; trades_30d: number; trades_total: number; open_ads: number; markets: string[]; since: string };
