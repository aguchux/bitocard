import { formatCurrency } from "@bitocard/api-client/storefront";

/** Money with the currency's own sign (₦1,140, GH₵5.50, KSh 200, $10), as Home shows it; whole amounts without ".00". */
export function money(minor: number, currency: string) {
  return formatCurrency(minor, currency, { trim: true });
}
