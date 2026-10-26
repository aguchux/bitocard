/**
 * B2B reselling's prices (`docs/BITOCARD_B2B_RESELLING_PLAN.md`, Prices): from the supplier's price P, the discount D
 * resellers earn (the listing's, or a bigger one in a deal), the markup limit M and a deal's floor F, a reseller sells at
 * S from P × (1 − F) to P × (1 + M); the supplier gets P × (1 − D) and the reseller the rest, less BitoCard's capped fee.
 * Pure functions on minor units, so the API, the apps' previews and the tests agree to the unit.
 */

/** P moved by a number of basis points (negative below it), rounded half up to a whole minor unit. */
export function moved(price: bigint, bps: number): bigint {
  return (price * BigInt(10_000 + bps) + 5_000n) / 10_000n;
}

/** A capped fee: the rate rounded down, never above its cap (Safe pay's own rule). */
export function cappedFee(amount: bigint, bps: number | null, cap: bigint | null): bigint {
  if (amount <= 0n || !bps || bps <= 0 || cap === null) return 0n;
  const byRate = (amount * BigInt(bps)) / 10_000n;
  return byRate < cap ? byRate : cap;
}

export type ResaleTerms = {
  /** What resellers earn off P: the listing's discount, or a deal's when bigger. */
  discountBps: number;
  /** How far below P a deal lets the reseller sell (0 without one). */
  floorBps: number;
  markupMaxBps: number;
};

/** The listing's terms with any running deal for this reseller: the bigger discount wins; the floor is the deal's. */
export function termsWith(listing: { resaleDiscountBps: number | null; resaleMarkupMaxBps: number | null }, deal: { discountBps: number; floorBps: number } | null): ResaleTerms {
  const base = listing.resaleDiscountBps ?? 0;
  return {
    discountBps: deal ? Math.max(base, deal.discountBps) : base,
    floorBps: deal ? Math.min(deal.floorBps, Math.max(base, deal.discountBps)) : 0,
    markupMaxBps: listing.resaleMarkupMaxBps ?? 0,
  };
}

/** The range a reseller may sell in. */
export function priceRange(supplierPrice: bigint, terms: ResaleTerms) {
  return { min: moved(supplierPrice, -terms.floorBps), max: moved(supplierPrice, terms.markupMaxBps) };
}

/** The reseller's price from their setting: a markup over P (it follows P), or a fixed price. */
export function resellerPrice(supplierPrice: bigint, setting: { markupBps: number | null; fixedPriceMinor: bigint | null }) {
  return setting.fixedPriceMinor ?? moved(supplierPrice, setting.markupBps ?? 0);
}

export type FeeRates = { resellerFeeBps: number | null; resellerFeeCapMinor: bigint | null; buyerFeeBps: number | null; buyerFeeCapMinor: bigint | null };

/** Everything one sale at price S would give each party (what a buyer pays, what the reseller keeps). */
export function breakdown(supplierPrice: bigint, price: bigint, terms: ResaleTerms, fees: FeeRates) {
  const range = priceRange(supplierPrice, terms);
  const supplierNet = moved(supplierPrice, -terms.discountBps);
  const margin = price - supplierNet;
  const resellerFee = cappedFee(margin, fees.resellerFeeBps, fees.resellerFeeCapMinor);
  return {
    range,
    inRange: price >= range.min && price <= range.max,
    margin,
    resellerFee,
    earnings: margin - resellerFee,
    buyerFee: cappedFee(price, fees.buyerFeeBps, fees.buyerFeeCapMinor),
  };
}
