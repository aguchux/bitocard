// Post an ad's "Let resellers sell this": tickable once reselling is open in the seller's country, and when it is not,
// saying why (the market's switch off, or Udozo still setting it up) instead of one sentence for both.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ShopResaleAvailability } from "@bitocard/api-client/classifieds";
import { ResaleFields, sellWhereFrom } from "@/components/account/resale-fields";

const availability = (open: boolean, reason: ShopResaleAvailability["reason"]) =>
  ({ object: "classified_resale_availability", country: "NG", open, reason, identity_required: false, identity_checked: true, payout_account: true, ready: open, discount_min_bps: 500, discount_max_bps: 5000, markup_max_bps: 3000 }) as ShopResaleAvailability;

const render = (value: ShopResaleAvailability) =>
  renderToStaticMarkup(createElement(ResaleFields, { value: sellWhereFrom(null, value), availability: value, priceMinor: 100000, priceOnRequest: false, currency: "NGN", invalid: () => false, onChange: () => undefined }));
const resaleBox = (html: string) => /<input type="checkbox"[^>]*>(?=(?:(?!<input)[\s\S])*Let resellers sell this)/.exec(html)?.[0] ?? "";

describe("Let resellers sell this", () => {
  it("can be ticked once reselling is open", () => {
    const html = render(availability(true, null));
    expect(resaleBox(html)).not.toContain("disabled");
    expect(html).toContain("Resellers sell it on their own stores");
  });

  it("says why it cannot be ticked yet", () => {
    const off = render(availability(false, "switch_off"));
    expect(resaleBox(off)).toContain("disabled");
    expect(off).toContain("Selling through resellers is not open in your country yet.");
    const setting = render(availability(false, "not_set_up"));
    expect(resaleBox(setting)).toContain("disabled");
    expect(setting).toContain("Udozo is still setting up selling through resellers in your country.");
  });
});
