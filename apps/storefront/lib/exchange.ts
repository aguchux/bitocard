import { formatCrypto, formatFace, type StoreExchange, type StoreExchangeAsset, type StoreExchangeQuote, type StoreExchangeSide } from "@bitocard/api-client/storefront";

/**
 * The exchange screen's maths, mirroring the API's (`src/crypto/exchange/pricing.ts`) so the screen shows what the quote
 * will say: BigInt only, rounded in the desk's favour. The quote is still the price that counts.
 */

export type Side = "buy" | "sell";
export type Unit = "fiat" | "coin";

const scale = (decimals: number) => 10n ** BigInt(decimals);

/** Money typed by people ("1,650.5") in minor units (two decimals), or null. */
export function parseFiat(text: string): bigint | null {
  const clean = text.replace(/[,\s]/g, "");
  const match = /^(\d{1,15})(?:\.(\d{0,2}))?$/.exec(clean);
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
}

/** A coin amount typed ("0.005") in base units, or null with more places than the coin keeps. */
export function parseCoin(text: string, decimals: number): bigint | null {
  const clean = text.replace(/[,\s]/g, "");
  const match = /^(\d{1,20})(?:\.(\d*))?$/.exec(clean);
  if (!match || (match[2] ?? "").length > decimals) return null;
  return BigInt(match[1]) * scale(decimals) + BigInt((match[2] ?? "").padEnd(decimals, "0") || "0");
}

/** Base units as a decimal string with every place ("0.00110011"). */
export function units(value: bigint, decimals: number) {
  const digits = value.toString().padStart(decimals + 1, "0");
  return decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
}

/** Minor units as typed money ("1650.50"), for filling the field. */
export const fiatText = (minor: bigint) => `${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`;

/** Coins and money for what was typed, at `price` (fiat minor units per whole coin). */
export function terms(side: Side, price: bigint, decimals: number, input: { amount?: bigint; fiat?: bigint }) {
  let amount: bigint;
  if (input.amount !== undefined) amount = input.amount;
  else if (side === "buy") amount = (input.fiat! * scale(decimals)) / price;
  else amount = (input.fiat! * scale(decimals) + price - 1n) / price;
  const raw = amount * price;
  const fiat = side === "buy" ? (raw + scale(decimals) - 1n) / scale(decimals) : raw / scale(decimals);
  return { amount, fiat };
}

/**
 * The most the customer can trade now, in coins and money: the smallest of what BitoCard's reserve allows, what they
 * have (money to buy with, coins to sell) and the per-trade maximum.
 */
export function maximum(side: Side, pair: StoreExchangeSide, decimals: number, have: { money: bigint; coins: bigint }) {
  const price = BigInt(pair.price);
  const exactReserve = parseCoin(pair.available_amount, decimals) ?? 0n;
  const cap = pair.max_fiat === null ? null : BigInt(pair.max_fiat);
  if (side === "buy") {
    let money = have.money < BigInt(pair.available_fiat) ? have.money : BigInt(pair.available_fiat);
    if (cap !== null && cap < money) money = cap;
    let amount = (money * scale(decimals)) / price;
    if (amount > exactReserve) amount = exactReserve;
    return { amount, fiat: terms("buy", price, decimals, { amount }).fiat };
  }
  let amount = have.coins < exactReserve ? have.coins : exactReserve;
  if (cap !== null) {
    const capped = (cap * scale(decimals)) / price;
    if (capped < amount) amount = capped;
  }
  return { amount, fiat: terms("sell", price, decimals, { amount }).fiat };
}

/** Why what was typed cannot be reviewed, or null. `kind` says which help the screen offers. */
export function problem(side: Side, pair: StoreExchangeSide, asset: Pick<StoreExchangeAsset, "asset" | "decimals">, trade: { amount: bigint; fiat: bigint }, have: { money: bigint; coins: bigint }) {
  if (trade.amount <= 0n || trade.fiat <= 0n) return { kind: "small" as const };
  const reserveCoins = parseCoin(pair.available_amount, asset.decimals) ?? 0n;
  if (side === "buy" && trade.amount > reserveCoins) return { kind: "reserve" as const };
  if (side === "sell" && trade.fiat > BigInt(pair.available_fiat)) return { kind: "reserve" as const };
  if (side === "buy" && trade.fiat > have.money) return { kind: "money" as const };
  if (side === "sell" && trade.amount > have.coins) return { kind: "coins" as const };
  if (trade.fiat < BigInt(pair.min_fiat)) return { kind: "below" as const };
  if (pair.max_fiat !== null && trade.fiat > BigInt(pair.max_fiat)) return { kind: "above" as const };
  return null;
}

/** "+1.84%" or "−0.4%" for a 24-hour change. */
export const changeText = (change: number) => `${change >= 0 ? "+" : "−"}${Math.abs(change).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;

/** A US dollar price for people ("$60,000", "$0.9996"). */
export function usdText(usd: string) {
  const value = Number(usd);
  return `$${value.toLocaleString("en-GB", { maximumFractionDigits: value >= 1 ? 2 : 6 })}`;
}

/** A markup in per cent for the screen ("1%", "1.5%"). */
export const percent = (bps: number) => `${(bps / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;

/** The exchange screen for a coin and side, optionally with an amount of money (minor units) to start from. */
export function exchangeHref(input: { asset: string; side: Side; fiat?: bigint | number | null }) {
  const query = new URLSearchParams({ asset: input.asset, side: input.side });
  if (input.fiat !== undefined && input.fiat !== null && BigInt(input.fiat) > 0n) query.set("fiat", String(input.fiat));
  return `/account/crypto/exchange?${query.toString()}`;
}

/** `?fiat=` on the exchange screen: whole minor units only, else null (never a guess). */
export function fiatParam(value: string | undefined): bigint | null {
  if (!value || !/^\d{1,15}$/.test(value)) return null;
  const minor = BigInt(value);
  return minor > 0n ? minor : null;
}

/**
 * The Buy and Sell links a coin's wallet row gets: only where the exchange is offered to the customer and that side is
 * open for the coin; Sell only while they hold some of it to sell.
 */
export function walletExchangeLinks(exchange: StoreExchange | null, asset: string, available: string) {
  const pair = exchange?.enabled ? exchange.assets.find(item => item.asset === asset) : undefined;
  if (!pair) return { buy: null, sell: null };
  const holds = (parseCoin(available, pair.decimals) ?? 0n) > 0n;
  return {
    buy: pair.buy ? exchangeHref({ asset, side: "buy" }) : null,
    sell: pair.sell && holds ? exchangeHref({ asset, side: "sell" }) : null,
  };
}

/** The reserve's price per coin and side (fiat minor units per whole coin), null where closed; nothing while the exchange is off. */
export type ReservePrices = Record<string, { buy: number | null; sell: number | null }>;

export function reservePrices(exchange: StoreExchange | null): ReservePrices {
  if (!exchange?.enabled) return {};
  return Object.fromEntries(exchange.assets.map(item => [item.asset, { buy: item.buy?.price ?? null, sell: item.sell?.price ?? null }]));
}

/** Where Quick buy or sell starts: BitoCard's reserve when it has a price for the coin and side, else the traders. */
export const initialSource = (prices: ReservePrices, asset: string, side: Side): "reserve" | "p2p" => (prices[asset]?.[side] ? "reserve" : "p2p");

/**
 * What the review says about the reserve: "Up to 0.42 BTC available from BitoCard." (buying) or the money it can pay
 * (selling), and, when the quote is exactly that most, that it is.
 */
export function availabilityText(quote: Pick<StoreExchangeQuote, "side" | "asset" | "currency" | "available" | "capped">, desk: string) {
  const most = quote.side === "buy" ? formatCrypto(quote.available.amount, quote.asset) : formatFace(quote.available.fiat, quote.currency);
  return {
    line: `Up to ${most} available from ${desk}.`,
    capped: quote.capped ? `This quote is the most ${desk} has available right now.` : null,
  };
}
