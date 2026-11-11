// The words and figures pos.udozo.com shows: money in the market's currency, plans and their limits, what sign-up takes
// today, where an account's plan stands, VAT as typed, and the app buttons.
import { describe, expect, it } from "vitest";
import { appPlatforms, dueToday, limitText, money, planFeatures, priceText, readVat, sortPlans, statusText, vatText } from "@/lib/pos";
import { account, plan, plans } from "./fixtures";

describe("money and plans", () => {
  it("writes minor units with the currency's sign, kobo only when there are some", () => {
    expect(money(1_500_000, "NGN")).toBe("₦15,000");
    expect(money(1_500_050, "NGN")).toBe("₦15,000.50");
    expect(money(250, "GHS")).toBe("GH₵2.50");
    expect(money(100, "XOF")).toBe("XOF 1");
  });

  it("prices a plan, or says Free, or that its price is coming", () => {
    expect(priceText(plan("free"))).toBe("Free");
    expect(priceText(plan("premium"))).toBe("₦15,000 a month");
    expect(priceText(plan("premium", { price: null }))).toBe("Price coming soon");
  });

  it("puts the plans in order and says what each includes from its limits", () => {
    expect(sortPlans(plans()).map(item => item.code)).toEqual(["free", "premium", "multi_shop"]);
    expect(limitText("shops", 1)).toBe("1 shop");
    expect(limitText("tills", null)).toBe("Unlimited tills");
    expect(limitText("products", 50)).toBe("50 products at the till");
    expect(planFeatures(plan("free"))).toEqual(["1 shop", "2 tills", "3 staff", "50 products at the till", "One stock count with your udozo.com listings", "No payment needed"]);
    expect(planFeatures(plan("multi_shop")).at(-1)).toBe("Paid monthly from your Udozo wallet");
  });

  it("takes nothing today for Free or a trial, and the first month otherwise", () => {
    expect(dueToday(plan("free"))).toBe(0);
    expect(dueToday(plan("premium"))).toBe(0);
    expect(dueToday(plan("multi_shop"))).toBe(4_000_000);
    expect(dueToday(plan("premium", { trial_days: 0, price: null }))).toBe(0);
  });
});

describe("where the plan stands", () => {
  it("says it in one sentence for each state", () => {
    expect(statusText(account())).toBe("You are on Free: no payment needed.");
    expect(statusText(account({ status: "trial", plan: plan("premium"), trial_ends_at: "2026-11-25T08:00:00.000Z" }))).toMatch(/^Your free trial of Premium ends on 25 November 2026\./);
    expect(statusText(account({ status: "active", plan: plan("premium"), period_end: "2026-12-11T08:00:00.000Z" }))).toBe("Premium renews on 11 December 2026, from your Udozo wallet.");
    expect(statusText(account({ status: "active", plan: plan("multi_shop"), next_plan: "premium", period_end: "2026-12-11T08:00:00.000Z" }), plans())).toBe("Multi-shop renews on 11 December 2026, when your shop moves to Premium.");
    expect(statusText(account({ status: "cancelling", plan: plan("premium"), period_end: "2026-12-11T08:00:00.000Z" }))).toBe("Premium runs until 11 December 2026, then your shop moves to Free.");
    expect(statusText(account({ status: "past_due", plan: plan("premium"), drops_to_free_at: "2026-12-18T08:00:00.000Z" }))).toMatch(/Add funds to your Udozo wallet by 18 December 2026/);
  });
});

describe("VAT", () => {
  it("reads what is typed into basis points, from 0% to 50%", () => {
    expect(readVat("7.5")).toBe(750);
    expect(readVat(" 7.5% ")).toBe(750);
    expect(readVat("0")).toBe(0);
    expect(readVat("50")).toBe(5000);
    expect(readVat("51")).toBeNull();
    expect(readVat("seven")).toBeNull();
    expect(readVat("7.555")).toBeNull();
    expect(vatText(750)).toBe("7.5%");
  });
});

describe("the apps", () => {
  it("lists Android, iPhone and iPad, and Windows, in that order", () => {
    expect(appPlatforms.map(item => item.key)).toEqual(["android", "ios", "windows"]);
    expect(appPlatforms.find(item => item.key === "windows")!.store).toBe("Microsoft Store");
  });
});
