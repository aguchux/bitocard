// Catalog > Pricing: discount rules split the supplier's discount between resellers and BitoCard (half each by
// default); markup rules add BitoCard's markup to cost.
import { describe, expect, test } from "vitest";
import { describeRule, splitText } from "@/app/(console)/catalog/pricing-labels";

const rule = { kind: "discount" as const, margin_bps: 1000, reseller_discount_bps: 0, reseller_share_bps: null as number | null, fixed_price: null, fixed_currency: null };

describe("pricing rules in words", () => {
  test("a split, the default half and an older fixed discount", () => {
    expect(splitText(6000)).toBe("60% to resellers, 40% to BitoCard");
    expect(describeRule({ ...rule, reseller_share_bps: 6000 })).toBe("The supplier’s discount is split 60% to resellers, 40% to BitoCard");
    expect(describeRule(rule)).toBe("The supplier’s discount is split 50% to resellers, 50% to BitoCard (default)");
    expect(describeRule({ ...rule, reseller_discount_bps: 150 })).toMatch(/older rule/);
  });

  test("markup and automatic", () => {
    expect(describeRule({ ...rule, kind: "markup" })).toMatch(/adds 10/);
    expect(describeRule({ ...rule, kind: "auto", reseller_share_bps: 7000 })).toMatch(/^The supplier’s discount is split 70% to resellers.*adds 10/);
  });
});
