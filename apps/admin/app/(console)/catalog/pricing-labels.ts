import { formatBps, formatMoney } from "@bitocard/admin-ui";
import type { PriceKind, PricingRule } from "@bitocard/api-client/admin";

export const kindLabels: Record<PriceKind, string> = {
  auto: "Automatic",
  discount: "Discount",
  markup: "Markup",
  fixed: "Fixed price",
};

/** Resellers' part and BitoCard's part of the supplier's discount, for example "60/40". */
export function splitText(shareBps: number) {
  const resellers = Math.round(shareBps / 100);
  return `${resellers}% to resellers, ${100 - resellers}% to BitoCard`;
}

/** How a discount rule shares the supplier's discount: its split, else an older fixed reseller discount, else half each. */
function discountText(rule: Pick<PricingRule, "reseller_discount_bps" | "reseller_share_bps">) {
  if (rule.reseller_share_bps !== null && rule.reseller_share_bps !== undefined) return `The supplier’s discount is split ${splitText(rule.reseller_share_bps)}`;
  if (rule.reseller_discount_bps > 0) return `Resellers get ${formatBps(rule.reseller_discount_bps)} off face value (older rule: set a split)`;
  return `The supplier’s discount is split ${splitText(5000)} (default)`;
}

/** What a rule does, in words. */
export function describeRule(rule: Pick<PricingRule, "kind" | "margin_bps" | "reseller_discount_bps" | "reseller_share_bps" | "fixed_price" | "fixed_currency">) {
  if (rule.kind === "fixed") return rule.fixed_price !== null && rule.fixed_currency ? `Sold to resellers at ${formatMoney(rule.fixed_price, rule.fixed_currency)}` : "Fixed price";
  if (rule.kind === "markup") return `BitoCard adds ${formatBps(rule.margin_bps)} to the supplier’s cost`;
  if (rule.kind === "discount") return discountText(rule);
  return `${discountText(rule)}; without a supplier discount, BitoCard adds ${formatBps(rule.margin_bps)} to cost`;
}

