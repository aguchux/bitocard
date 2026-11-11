/**
 * Udozo POS's money (docs/UDOZO_POS_PLAN.md): whole minor units as bigint, as the ledger keeps them, so a sale's totals
 * and a plan's charge are exact. Pure, so the API, the till and the tests agree on every number.
 */

export type SaleLine = {
  /** The price of one, in minor units. */
  unit: bigint;
  quantity: number;
  /** Off this line, in minor units (never more than the line). */
  discount?: bigint;
};

export type SaleTotals = {
  items: number;
  subtotal: bigint;
  discount: bigint;
  taxable: bigint;
  vat: bigint;
  total: bigint;
};

/** A share in basis points, rounded half up (VAT is never rounded down to nothing on a small sale). */
export function shareOf(amount: bigint, bps: number) {
  if (!Number.isInteger(bps) || bps < 0) throw new RangeError('bps must be a whole number of basis points');
  return (amount * BigInt(bps) + 5000n) / 10000n;
}

/**
 * A sale's totals: the lines (each less its own discount), less the sale's discount, then VAT added at the shop's rate
 * (`vatBps`, 750 is 7.5%) on what is left. Discounts never take a line or the sale below zero.
 */
export function saleTotals(lines: readonly SaleLine[], options: { discount?: bigint; vatBps?: number } = {}): SaleTotals {
  let items = 0;
  let subtotal = 0n;
  let lineDiscounts = 0n;
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) throw new RangeError('quantity must be a whole number from 1');
    if (line.unit < 0n) throw new RangeError('unit must not be negative');
    const gross = line.unit * BigInt(line.quantity);
    const off = line.discount ?? 0n;
    if (off < 0n) throw new RangeError('discount must not be negative');
    items += line.quantity;
    subtotal += gross;
    lineDiscounts += off > gross ? gross : off;
  }
  const saleDiscount = options.discount ?? 0n;
  if (saleDiscount < 0n) throw new RangeError('discount must not be negative');
  const afterLines = subtotal - lineDiscounts;
  const discount = lineDiscounts + (saleDiscount > afterLines ? afterLines : saleDiscount);
  const taxable = subtotal - discount;
  const vat = shareOf(taxable, options.vatBps ?? 0);
  return { items, subtotal, discount, taxable, vat, total: taxable + vat };
}

/** The change for cash handed over, or null when it does not cover the amount. */
export function cashChange(amount: bigint, handed: bigint) {
  return handed >= amount ? handed - amount : null;
}

/** One calendar month on, in UTC (31 January is followed by the last day of February). */
export function addMonth(from: Date) {
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1, from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(from.getUTCDate(), lastDay));
  return next;
}

/** One year on, in UTC (29 February is followed by 28 February). */
export function addYear(from: Date) {
  const year = from.getUTCFullYear() + 1;
  const lastDay = new Date(Date.UTC(year, from.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, from.getUTCMonth(), Math.min(from.getUTCDate(), lastDay), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
}

/**
 * What is left of a paid period, as credit towards a dearer plan: the price times the share of the period not used yet,
 * rounded down (Udozo never credits more than was paid).
 */
export function unusedCredit(price: bigint, periodStart: Date, periodEnd: Date, now: Date) {
  const total = BigInt(periodEnd.getTime() - periodStart.getTime());
  const left = BigInt(Math.max(0, Math.min(periodEnd.getTime() - now.getTime(), periodEnd.getTime() - periodStart.getTime())));
  if (total <= 0n || price <= 0n) return 0n;
  return (price * left) / total;
}
