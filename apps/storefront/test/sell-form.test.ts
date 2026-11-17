// Selling a gift card on its page: Buy and Sell as two tabs where the card can be sold (both kept mounted, `?sell=1`
// opening on Sell); the sell form asks a signed-out shopper to sign in first, shows the rate after BitoCard's margin,
// never the buyer's name, and lets the customer choose between kinds of the card and between photos and a code.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { GiftCardSellOffer } from "@bitocard/api-client/storefront";
import { setRequest } from "./request";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/lib/sell-actions", () => ({ quoteSale: async () => ({ ok: false, message: "", code: null }), simulateSale: async () => {} }));

const { BuySell } = await import("@/components/store/buy-sell");
const { SellForm, estimate } = await import("@/components/store/sell-form");
const { sellOptionsFor, sellingOpenIn } = await import("@/lib/gift-card-sales");

const offer = (id: string, form: GiftCardSellOffer["form"], name = "Amazon (USA)"): GiftCardSellOffer => ({ id, name, form, minimum: 25, maximum: 10_000, currency: "NGN", rate: 114_000, terms: "No used cards" });
const render = (offers: GiftCardSellOffer[], signedIn = true) => renderToStaticMarkup(createElement(SellForm, { offers, signedIn, back: "/p/gift_cards%3AUS%3Aamazon?sell=1" }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("buy or sell tabs", () => {
  test("two tabs, both panels mounted, the chosen one shown", () => {
    const html = renderToStaticMarkup(createElement(BuySell, { buy: createElement("p", null, "BUY FORM"), sell: createElement("p", null, "SELL FORM"), initial: "sell" }));
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/aria-selected="true"[^>]*>Sell</);
    expect(html).toContain("BUY FORM");
    expect(html).toContain("SELL FORM");
    expect(html).toMatch(/role="tabpanel"[^>]*hidden=""[^>]*>.*BUY FORM/);
  });
});

describe("sell form", () => {
  test("signed out: the rate, then sign in and come back to Sell", () => {
    const html = render([offer("a", "both")], false);
    expect(html).toContain("₦1,140");
    expect(html).toContain('href="/signin?next=%2Fp%2Fgift_cards%253AUS%253Aamazon%3Fsell%3D1"');
    expect(html).not.toMatch(/prestmit/i);
  });

  test("signed in: one kind of card named with its rate; photos or a code where both are taken", () => {
    const html = render([offer("a", "both")]);
    expect(html).toContain("Amazon (USA)");
    expect(html).toContain("A physical card");
    expect(html).toContain("An e-code");
    expect(html).toContain("No used cards");
    expect(html).toContain("See what you get");
  });

  test("several kinds: a choice between them; an e-code-only card asks for its code", () => {
    expect(render([offer("a", "physical"), offer("b", "ecode", "Amazon e-code")])).toContain("Which card is it?");
    const ecode = render([offer("b", "ecode")]);
    expect(ecode).toContain("The card’s code");
    expect(ecode).not.toContain("Photos of the card");
  });

  test("the estimate is the rate times the value, rounded down", () => {
    expect(estimate(offer("a", "both"), 100)).toBe(11_400_000);
    expect(estimate({ ...offer("a", "both"), rate: 333 }, 3)).toBe(999);
  });
});

describe("what can be sold", () => {
  test("gift cards only, in the shopper's country, asked of the store each time", async () => {
    setRequest({ host: "bitocard.com" });
    vi.stubEnv("API_URL", "http://api.test");
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ object: "gift_card_sell_options", available: true, reason: null, currency: "NGN", offers: [] }), { status: 200 });
    });
    expect(await sellOptionsFor("airtime:NG:mtn:topup", "NG")).toBeNull();
    expect(await sellOptionsFor("gift_cards:US:amazon", null)).toBeNull();
    expect((await sellOptionsFor("gift_cards:US:amazon", "NG"))?.available).toBe(true);
    expect(await sellingOpenIn("NG")).toBe(true);
    expect(urls).toEqual(["http://api.test/v1/store/gift-card-sales/offers?product=gift_cards%3AUS%3Aamazon&country=NG", "http://api.test/v1/store/gift-card-sales/offers?country=NG"]);
    // A reseller's store names itself: the API decides whether it buys cards (buy back) and at its rate.
    setRequest({ host: "ada.bitocard.com" });
    await sellOptionsFor("gift_cards:US:amazon", "NG");
    expect(urls.at(-1)).toBe("http://api.test/v1/store/gift-card-sales/offers?product=gift_cards%3AUS%3Aamazon&country=NG&store=ada");
  });
});
