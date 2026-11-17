// Gift cards on the store are sold by rate: the page shows the store's rate per unit of the card's currency and what
// each value costs, read from the API's rate route for the country the shopper pays from; the buy form's values use it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { formatRate, ratePrice, type StoreRateShown } from "@bitocard/api-client/storefront";
import { setRequest } from "./request";

const { rateFor } = await import("@/lib/rate");
const { RateCard } = await import("@/components/store/rate-card");

const rate: StoreRateShown = { object: "store_rate", rate: 172_432.28, currency: "NGN", face_currency: "USD", values: [{ face_value: 2500, price: 4_310_807 }, { face_value: 5000, price: 8_621_614 }] };

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({ host: "bitocard.com" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("gift card rates on the store", () => {
  test("the rate reads per one unit of the card's currency, and each value's price comes from it", () => {
    expect(formatRate(rate)).toBe("₦1,724.32 per $1");
    expect(ratePrice(rate, 5000)).toEqual({ amount: 8_621_614, currency: "NGN" });
    expect(ratePrice(rate, 1000)).toBeNull();
    expect(ratePrice(null, 2500)).toBeNull();
  });

  test("asks the rate route for the shopper's country, with the store named on a reseller's store; never a currency", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(rate)));
    vi.stubGlobal("fetch", fetch);
    expect(await rateFor({ key: "gift_cards:US:amazon:usd", category: "gift_cards" }, "NG")).toEqual(rate);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe("http://api.test/v1/store/products/gift_cards%3AUS%3Aamazon%3Ausd/rate?country=NG");
    setRequest({ host: "ada.bitocard.com" });
    await rateFor({ key: "gift_cards:US:amazon:usd", category: "gift_cards" }, "NG");
    expect(String((fetch.mock.calls[1] as unknown[])[0])).toContain("rate?country=NG&store=ada");
  });

  test("no rate for other products, without a country, when the card is not sold by rate, or when the API fails", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ object: "store_rate", rate: null })));
    vi.stubGlobal("fetch", fetch);
    expect(await rateFor({ key: "airtime:NG:mtn:topup", category: "airtime" }, "NG")).toBeNull();
    expect(await rateFor({ key: "gift_cards:US:amazon:usd", category: "gift_cards" }, null)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(await rateFor({ key: "gift_cards:US:amazon:usd", category: "gift_cards" }, "NG")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await rateFor({ key: "gift_cards:US:amazon:usd", category: "gift_cards" }, "NG")).toBeNull();
  });

  test("the rate card shows the rate and each value's price", () => {
    const html = renderToStaticMarkup(createElement(RateCard, { rate }));
    expect(html).toContain("Our rate");
    expect(html).toContain("₦1,724.32 per $1");
    expect(html).toContain("$25 card");
    expect(html).toContain("₦43,108.07");
    expect(html).toContain("$50 card");
  });
});
