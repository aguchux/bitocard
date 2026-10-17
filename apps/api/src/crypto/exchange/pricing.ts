import { Prisma } from '../../generated/prisma/client.js';
import { fiatFor, unitsFor } from '../amounts.js';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export type ExchangeSide = 'buy' | 'sell';

/** Markups are basis points, at most 20%. */
export const maxMarkupBps = 2000;

/** A held quote lasts this long. */
export const quoteLifetimeMs = 30_000;

/** Fiat minor units per whole coin at the market: the US dollar price (x 1e8) at the currency's mid rate (2 decimals). */
export function marketPriceMinor(usdE8: bigint, fxMid: Decimal): Decimal {
  return new Decimal(usdE8.toString()).mul(fxMid).div(1_000_000);
}

/**
 * The desk's price per whole coin, in fiat minor units, from the market price and its markup, always in the desk's
 * favour: a customer buying pays the market price plus the markup, rounded up; selling gets it less the markup, rounded
 * down. At least one minor unit.
 */
export function deskPrice(usdE8: bigint, fxMid: Decimal, markupBps: number, side: ExchangeSide): bigint {
  const market = marketPriceMinor(usdE8, fxMid);
  const factor = new Decimal(10_000 + (side === 'buy' ? markupBps : -markupBps)).div(10_000);
  const price = market.mul(factor).toDecimalPlaces(0, side === 'buy' ? Decimal.ROUND_UP : Decimal.ROUND_DOWN);
  const value = BigInt(price.toFixed(0));
  return value > 0n ? value : 1n;
}

/**
 * What a trade moves at `price`, from what the customer typed: the coin amount (`amount`, base units) or the money
 * (`fiat`, minor units). Rounded in the desk's favour: buying, coins down and money up (never more than the money
 * typed); selling, money down (a typed money amount needs the coins rounded up).
 */
export function tradeTerms(side: ExchangeSide, price: bigint, decimals: number, input: { amount?: bigint; fiat?: bigint }) {
  let amount: bigint;
  if (input.amount !== undefined) amount = input.amount;
  else if (side === 'buy') amount = unitsFor(input.fiat!, price, decimals);
  else {
    const scale = 10n ** BigInt(decimals);
    amount = (input.fiat! * scale + price - 1n) / price;
  }
  const fiat = fiatFor(amount, price, decimals, side === 'buy');
  return { amount, fiat };
}

/** The desk's margin on a trade, in fiat minor units: the gap between its price and the market's, never negative. */
export function markupEarned(side: ExchangeSide, fiat: bigint, amount: bigint, usdE8: bigint, fxMid: Decimal, decimals: number): bigint {
  const atMarket = marketPriceMinor(usdE8, fxMid).mul(amount.toString()).div(new Decimal(10).pow(decimals));
  const gap = side === 'buy' ? new Decimal(fiat.toString()).minus(atMarket) : atMarket.minus(fiat.toString());
  const value = BigInt(gap.toDecimalPlaces(0, Decimal.ROUND_DOWN).toFixed(0));
  return value > 0n ? value : 0n;
}

/** The most coins a reserve lets a customer buy and what they cost; or the most money it lets them sell for. */
export function available(side: ExchangeSide, price: bigint, decimals: number, reserve: bigint) {
  if (side === 'buy') return { amount: reserve, fiat: fiatFor(reserve, price, decimals, false) };
  return { amount: unitsFor(reserve, price, decimals), fiat: reserve };
}
