import { formatPrice } from "@bitocard/api-client/storefront";

/** Money with the currency's own symbol (₦1,140), as Home shows it; the code where there is none. */
export function money(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: minor % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(minor / 100);
  } catch {
    return formatPrice(minor, currency);
  }
}
