import { formatBps, formatMoney } from "@bitocard/admin-ui";
import type { PriceKind, PricingRule } from "@bitocard/api-client/admin";

export const kindLabels: Record<PriceKind, string> = {
  auto: "Automatic",
  discount: "Discount",
  markup: "Markup",
  fixed: "Fixed price",
};

/** What a rule does, in words. */
export function describeRule(rule: Pick<PricingRule, "kind" | "margin_bps" | "reseller_discount_bps" | "fixed_price" | "fixed_currency">) {
  if (rule.kind === "fixed") return rule.fixed_price !== null && rule.fixed_currency ? `Sold to resellers at ${formatMoney(rule.fixed_price, rule.fixed_currency)}` : "Fixed price";
  if (rule.kind === "markup") return `BitoCard adds ${formatBps(rule.margin_bps)} to the supplier’s cost`;
  if (rule.kind === "discount") return `Resellers get ${formatBps(rule.reseller_discount_bps)} off face value`;
  return `Resellers get ${formatBps(rule.reseller_discount_bps)} off face value; without a supplier discount, BitoCard adds ${formatBps(rule.margin_bps)} to cost`;
}

