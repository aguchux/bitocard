import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { StoreCryptoWallets, StoreP2pAd } from "@bitocard/api-client/storefront";

const customerApi = vi.fn();
vi.mock("@/lib/customer", () => ({ customerApi: (...args: unknown[]) => customerApi(...args) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  useRouter: () => ({ push: () => undefined }),
}));

const { amountMinor, cleanAmount, marketHref, marketQuery, marketState, shownAds } = await import("@/lib/p2p-market");
const { MarketAds, MarketFilters } = await import("@/components/app/p2p-market");
const { CryptoNav } = await import("@/components/app/crypto");
const { default: MarketPage } = await import("@/app/(app)/account/crypto/page");
const { default: MarketMoved } = await import("@/app/(app)/account/crypto/market/page");

const ad = (id: string, trades: number, extra: Partial<StoreP2pAd> = {}): StoreP2pAd => ({
  object: "p2p_ad",
  id,
  mode: "live",
  side: "sell",
  asset: "USDT",
  decimals: 6,
  currency: "NGN",
  country: "NG",
  market: "NG",
  price: 165000,
  available: "250.000000",
  total: "300.000000",
  filled: "50.000000",
  min_fiat: 1000000,
  max_fiat: 40000000,
  fee_bps: 20,
  terms: null,
  status: "active",
  mine: false,
  trader: { nickname: `Trader${id}`, trades_30d: trades, trades_total: trades },
  created_at: "2026-10-26T10:00:00.000Z",
  updated_at: "2026-10-26T10:00:00.000Z",
  ...extra,
});

const wallets = (extra: Partial<StoreCryptoWallets> = {}) =>
  ({
    object: "crypto_wallets",
    mode: "live",
    enabled: true,
    p2p_enabled: true,
    frozen: false,
    verified: true,
    declaration: { version: "2026-10-27", declared: true },
    currency: "NGN",
    assets: ["USDT", "BTC"].map(asset => ({ asset, name: asset, enabled: true, available: "0", locked: "0", frozen: "0", withdrawing: "0" })),
    ...extra,
  }) as unknown as StoreCryptoWallets;

const ok = <T>(data: T) => ({ ok: true, status: 200, data });

describe("the P2P market's filters", () => {
  test("read from the address, keeping only what is open and valid", () => {
    expect(marketState({}, ["USDT", "BTC"], "NGN")).toEqual({ side: "buy", asset: "USDT", currency: "NGN", amount: "", q: "", experienced: false, sort: "price", view: "grid" });
    const state = marketState({ side: "sell", asset: "btc", currency: "usd", amount: "50,000", q: "  Ada ", experienced: "1", sort: "trades", view: "list" }, ["USDT", "BTC"], "NGN");
    expect(state).toEqual({ side: "sell", asset: "BTC", currency: "USD", amount: "50000", q: "Ada", experienced: true, sort: "trades", view: "list" });
    // A coin that is not open, another currency and nonsense fall back.
    expect(marketState({ asset: "XRP", currency: "EUR", side: "steal", view: "tiles", amount: "-5" }, ["USDT"], "NGN")).toMatchObject({ asset: "USDT", currency: "NGN", side: "buy", view: "grid", amount: "" });
  });

  test("amounts: positive, two places at most, sent to the API in minor units", () => {
    expect(cleanAmount("1,250.5")).toBe("1250.5");
    expect(cleanAmount("0")).toBe("");
    expect(cleanAmount("12.345")).toBe("");
    expect(amountMinor("1250.5")).toBe(125050);
    expect(amountMinor("")).toBeNull();
  });

  test("links keep every filter but leave defaults out; the API is asked only what it filters", () => {
    const state = marketState({ side: "sell", asset: "BTC", amount: "500", experienced: "1", view: "list" }, ["USDT", "BTC"], "NGN");
    expect(marketHref(state)).toBe("/account/crypto?side=sell&asset=BTC&currency=NGN&amount=500&experienced=1&view=list");
    expect(marketHref(state, { view: "grid", experienced: false, amount: "" })).toBe("/account/crypto?side=sell&asset=BTC&currency=NGN");
    expect(marketQuery(state)).toBe("asset=BTC&side=sell&currency=NGN&fiat=50000");
  });

  test("experienced traders only, and most trades first with the book's price order kept between equals", () => {
    const ads = [ad("a", 2), ad("b", 40), ad("c", 12), ad("d", 40)];
    const state = marketState({}, ["USDT"], "NGN");
    expect(shownAds(ads, state).map(item => item.id)).toEqual(["a", "b", "c", "d"]);
    expect(shownAds(ads, { ...state, experienced: true }).map(item => item.id)).toEqual(["b", "c", "d"]);
    expect(shownAds(ads, { ...state, sort: "trades" }).map(item => item.id)).toEqual(["b", "d", "c", "a"]);
  });
});

describe("the market's views", () => {
  const state = marketState({}, ["USDT", "BTC"], "NGN");

  test("the grid shows cards, the list a table with headings; each ad can be taken", () => {
    const ads = [ad("a", 12, { terms: "Fast replies" }), ad("b", 1)];
    const grid = renderToStaticMarkup(createElement(MarketAds, { ads, state }));
    expect(grid).toContain("xl:grid-cols-3");
    expect(grid).toContain("Fast replies");
    expect(grid).toContain('aria-label="Experienced trader"');
    // Each ad: its button and its dialog's title.
    expect(grid.match(/Buy USDT/g)).toHaveLength(4);
    const list = renderToStaticMarkup(createElement(MarketAds, { ads, state: { ...state, view: "list" } }));
    expect(list).toContain("Per trade");
    expect(list).toContain("Trader");
    expect(list).not.toContain("xl:grid-cols-3");
  });

  test("the filters: buy or sell, coins, currencies, the amount and trader form, experienced, order and view", () => {
    const html = renderToStaticMarkup(createElement(MarketFilters, { state: { ...state, view: "list" }, assets: ["USDT", "BTC"], currencies: ["NGN", "USD"] }));
    expect(html).toContain('href="/account/crypto?side=sell&amp;asset=USDT&amp;currency=NGN&amp;view=list"');
    expect(html).toContain('href="/account/crypto?side=buy&amp;asset=BTC&amp;currency=NGN&amp;view=list"');
    expect(html).toContain('href="/account/crypto?side=buy&amp;asset=USDT&amp;currency=USD&amp;view=list"');
    expect(html).toContain('href="/account/crypto?side=buy&amp;asset=USDT&amp;currency=NGN&amp;experienced=1&amp;view=list"');
    expect(html).toContain('href="/account/crypto?side=buy&amp;asset=USDT&amp;currency=NGN"');
    expect(html).toContain('action="/account/crypto"');
    expect(html).toContain("I want to spend (NGN)");
    expect(html).toContain('name="view" value="list"');
  });
});

describe("the Crypto tab opens on the market", () => {
  beforeEach(() => customerApi.mockReset());

  test("full width, Post ad at the top right, the ads asked with the filters", async () => {
    customerApi.mockImplementation(async (_method: string, path: string) => (path === "/v1/store/crypto" ? ok(wallets()) : ok({ object: "list", data: [ad("a", 12), ad("b", 3)] })));
    const html = renderToStaticMarkup(await MarketPage({ searchParams: Promise.resolve({ asset: "BTC", amount: "1000", experienced: "1" }) }));
    expect(customerApi).toHaveBeenCalledWith("GET", "/v1/store/p2p/market?asset=BTC&side=buy&currency=NGN&fiat=100000");
    expect(html).toContain("data-full-bleed");
    expect(html).toContain("P2P market");
    expect(html).toContain("Post ad");
    expect(html).toContain('href="/account/crypto/ads"');
    expect(html).toContain("1 ad selling BTC for NGN");
    expect(html).toContain("Tradera");
    expect(html).not.toContain("Traderb");
  });

  test("before trading, the declaration: not a citizen or resident of the US or UK, and no market until it is made", async () => {
    customerApi.mockImplementation(async () => ok(wallets({ declaration: { version: "2026-10-27", declared: false } })));
    const html = renderToStaticMarkup(await MarketPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("One question before you trade");
    expect(html).toContain("I am not a citizen or a resident of the United States or the United Kingdom.");
    expect(html).toContain('name="version" value="2026-10-27"');
    expect(html).toMatch(/<input type="checkbox" required=""[^>]*name="confirm" value="yes"/);
    expect(html).not.toContain("Post ad");
    expect(customerApi).toHaveBeenCalledTimes(1);
  });

  test("with nothing matching, it says so and offers to clear the filters", async () => {
    customerApi.mockImplementation(async (_method: string, path: string) => (path === "/v1/store/crypto" ? ok(wallets()) : ok({ object: "list", data: [] })));
    const html = renderToStaticMarkup(await MarketPage({ searchParams: Promise.resolve({ q: "Ada" }) }));
    expect(html).toContain("No ads match your filters");
    expect(html).toContain("Clear filters");
  });

  test("where P2P is not open to the customer the tab opens on their wallets; unverified, it explains why", async () => {
    customerApi.mockResolvedValueOnce(ok(wallets({ p2p_enabled: false })));
    await expect(MarketPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/account/crypto/wallets");
    customerApi.mockResolvedValueOnce(ok(wallets({ verified: false })));
    const html = renderToStaticMarkup(await MarketPage({ searchParams: Promise.resolve({}) }));
    expect(customerApi).toHaveBeenCalledTimes(2);
    expect(html).not.toContain("Post ad");
  });

  test("the old Market address goes to the tab with its filters", async () => {
    await expect(MarketMoved({ searchParams: Promise.resolve({ asset: "USDT", side: "sell" }) })).rejects.toThrow("redirect:/account/crypto?asset=USDT&side=sell");
    await expect(MarketMoved({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/account/crypto");
  });
});

describe("the Crypto tab's places", () => {
  test("underlined tabs, the market first, the current one marked, with the grey line running on to the end", () => {
    const html = renderToStaticMarkup(createElement(CryptoNav, { current: "/account/crypto/wallets" }));
    expect(html).toContain('aria-label="Crypto"');
    expect(html.match(/<a /g)).toHaveLength(8);
    expect(html.indexOf("P2P market")).toBeLessThan(html.indexOf("Wallets"));
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*>Wallets<\/a>/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain("border-b-2 border-slate-200");
    expect(html).toContain("aria-[current=page]:border-brand-500");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("scroll-smooth");
    expect(html).not.toContain("rounded-full");
  });
});
