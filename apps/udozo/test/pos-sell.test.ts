// Post an ad's "Sell at your shop with Udozo POS" (docs/UDOZO_POS_PLAN.md, milestone 2): tickable with a Udozo POS
// account and room in its plan, saying why not otherwise with a link to pos.udozo.com; once ticked, the barcode and
// reorder level; a listing at the shop only is enough for the Where to sell step; and My listings tags it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ShopPosStatus } from "@bitocard/api-client/classifieds";
import { posOption, ResaleFields, sellWhereFrom } from "@/components/account/resale-fields";
import { listingChannelTags } from "@/lib/shop";
import { stepOf, stepProblem, type PostValues } from "@/lib/post-steps";

const status = (over: Partial<ShopPosStatus> = {}): ShopPosStatus => ({ object: "pos_status", account: true, plan: { code: "free", name: "Free" }, products: { used: 2, limit: 50 }, ...over });

const render = (pos: ShopPosStatus | null, value = sellWhereFrom(null, null), invalid: (param: string) => boolean = () => false) =>
  renderToStaticMarkup(createElement(ResaleFields, { value, availability: null, pos, priceMinor: 100000, priceOnRequest: false, currency: "NGN", invalid, onChange: () => undefined }));
const posBox = (html: string) => /<input type="checkbox"[^>]*>(?=(?:(?!<input)[\s\S])*Sell at your shop with Udozo POS)/.exec(html)?.[0] ?? "";

describe("Sell at your shop with Udozo POS", () => {
  it("can be ticked with a Udozo POS account and room in its plan, saying how many are used", () => {
    const html = render(status());
    expect(posBox(html)).not.toContain("disabled");
    expect(html).toContain("2 of 50 on Free");
    expect(posOption(status({ plan: { code: "premium", name: "Premium" }, products: { used: 900, limit: null } }), false)).toEqual({ allowed: true, note: "Sold at your shop's till from the same stock." });
  });

  it("without Udozo POS, links to setting it up; at the plan's limit, to the plans", () => {
    const none = render(status({ account: false, plan: null, products: { used: 0, limit: null } }));
    expect(posBox(none)).toContain("disabled");
    expect(none).toContain("Set up your shop on Udozo POS first");
    expect(none).toContain('href="https://pos.udozo.com/signup"');
    const full = render(status({ products: { used: 50, limit: 50 } }));
    expect(posBox(full)).toContain("disabled");
    expect(full).toContain("Your Free sells 50 products at your shop, and all are used.");
    expect(full).toContain('href="https://pos.udozo.com/app/billing"');
    expect(posOption(null, false).allowed).toBe(false);
  });

  it("a listing already ticked can always stay, and once ticked asks for the barcode and reorder level", () => {
    expect(posOption(status({ products: { used: 50, limit: 50 } }), true).allowed).toBe(true);
    const listing = { on_shop: false, resale: { enabled: false, discount_bps: null, markup_max_bps: null }, stock: 4, pos_enabled: true, barcode: "4006381333931", reorder_level: 2 };
    const value = sellWhereFrom(listing, null);
    expect(value).toMatchObject({ pos: true, barcode: "4006381333931", reorderLevel: "2", onShop: false });
    const html = render(status({ products: { used: 50, limit: 50 } }), value, param => param === "barcode");
    expect(posBox(html)).not.toContain("disabled");
    expect(html).toContain("At your shop only: it never shows on Udozo.");
    expect(html).toContain('value="4006381333931"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Reorder level (optional)");
    expect(render(status())).not.toContain("Barcode (optional)");
  });
});

describe("the Where to sell step", () => {
  const values: PostValues = { title: "Samsung TV", categoryId: "c1", readyPhotos: 4, uploadingPhotos: 0, failedPhotos: 0, minPhotos: 4, priceKind: "fixed", priceMinor: 100, condition: "new", onShop: false, resale: false, pos: false, areaId: "a1" };

  it("is complete when sold at the shop only, and its fields' refusals open it", () => {
    expect(stepProblem(3, values)?.param).toBe("on_shop");
    expect(stepProblem(3, { ...values, pos: true })).toBeNull();
    for (const param of ["pos_enabled", "barcode", "reorder_level"]) expect(stepOf(param)).toBe(3);
  });

  it("My listings tags a listing sold at the shop, or at the shop only", () => {
    const base = { on_shop: true, resale: { enabled: false, discount_bps: null, markup_max_bps: null, paused: false }, stock: 1, status: "active" as const };
    expect(listingChannelTags({ ...base, pos_enabled: true })).toEqual(["At your shop"]);
    expect(listingChannelTags({ ...base, on_shop: false, pos_enabled: true })).toEqual(["Shop only"]);
    expect(listingChannelTags(base)).toEqual([]);
  });

  it("sold at the shop only, needs no photos, condition or area, only a price for the till", () => {
    const shopOnly = { ...values, pos: true, shopOnly: true, readyPhotos: 0, condition: null, areaId: null };
    for (const step of [1, 3, 4]) expect(stepProblem(step, shopOnly), `step ${step}`).toBeNull();
    expect(stepProblem(2, shopOnly)).toBeNull();
    expect(stepProblem(2, { ...shopOnly, priceKind: "on_request" })?.message).toBe("Enter the price your till sells it at.");
    expect(stepProblem(1, { ...shopOnly, shopOnly: false })?.param).toBe("photos");
  });

  it("in a shop-only category, Udozo and resellers cannot be ticked and the shop stays ticked", () => {
    const value = { ...sellWhereFrom(null, null), onShop: false, pos: true };
    const html = renderToStaticMarkup(createElement(ResaleFields, { value, availability: null, pos: status(), shopCategory: true, priceMinor: 100000, priceOnRequest: false, currency: "NGN", invalid: () => false, onChange: () => undefined }));
    const boxes = [...html.matchAll(/<input type="checkbox"[^>]*>/g)].map(match => match[0]);
    expect(boxes).toHaveLength(3);
    for (const box of boxes) expect(box).toContain("disabled");
    expect(html).toContain("Its category is sold only at your shop with Udozo POS");
    expect(html).not.toContain("Set up Udozo POS");
  });
});
