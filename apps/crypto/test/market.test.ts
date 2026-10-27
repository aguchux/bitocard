import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CryptoMarkets } from "@bitocard/api-client/crypto";
import type { StoreP2pAd } from "@bitocard/api-client/storefront";

const { book, bookQuery, cryptoApi, marketAt, marketPath } = await import("@/lib/api");
const { MarketBook } = await import("@/components/book");
const { MarketNav } = await import("@/components/header");
const { MarketsList } = await import("@/components/markets-list");
const { TraderCard } = await import("@/components/trader-card");
const { marketMetadata, pageState } = await import("@/components/market-page");

const shown: CryptoMarkets = {
  object: "list",
  mode: "live",
  assets: ["USDT", "BTC"],
  data: [
    { object: "crypto_market", market: "WW", name: "Global", currencies: ["USD"], ads: { USD: 3 } },
    { object: "crypto_market", market: "NG", name: "Nigeria", currencies: ["NGN", "USD"], ads: { NGN: 5, USD: 1 } },
  ],
};

const ad = (id: string, extra: Partial<StoreP2pAd> = {}): StoreP2pAd => ({
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
  available: "100.000000",
  total: "100.000000",
  filled: "0.000000",
  min_fiat: 1000_00,
  max_fiat: 50_000_00,
  fee_bps: 20,
  terms: null,
  status: "active",
  mine: false,
  trader: { nickname: `Trader${id}`, trades_30d: 3, trades_total: 12 },
  created_at: "2026-10-27T10:00:00.000Z",
  updated_at: "2026-10-27T10:00:00.000Z",
  ...extra,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** Answers the API's public crypto endpoints from fixtures. */
const answer = (ads: StoreP2pAd[] = [ad("a")]) =>
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/v1/crypto/markets")) return json(shown);
    if (url.includes("/ads?")) return json({ object: "list", market: "NG", asset: "USDT", currency: "NGN", side: "buy", data: ads });
    if (url.includes("/v1/crypto/traders/TraderA")) return json({ object: "p2p_trader", nickname: "TraderA", trades_30d: 4, trades_total: 15, open_ads: 2, markets: ["NG", "WW"], since: "2026-09-01T00:00:00.000Z" });
    return json({ error: { code: "resource_missing" } }, 404);
  });

describe("reading the public data, cached", () => {
  test("every read goes through the data cache for a minute, tagged; an unreachable API never throws", async () => {
    answer();
    expect((await cryptoApi("/v1/crypto/markets", ["crypto:markets"])).ok).toBe(true);
    expect(fetchMock.mock.calls[0][1]).toEqual({ next: { revalidate: 60, tags: ["crypto", "crypto:markets"] } });
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await cryptoApi("/v1/crypto/markets")).toEqual({ ok: false, status: 0, code: null });
    expect(await cryptoApi("/v1/crypto/traders/nobody")).toEqual({ ok: false, status: 404, code: "resource_missing" });
  });

  test("a book's query is always written in one order, so the same book is one cache entry; each market is tagged", async () => {
    expect(bookQuery({ asset: "USDT", side: "buy", currency: "NGN", fiat: 100000, q: "" })).toBe("asset=USDT&side=buy&currency=NGN&fiat=100000");
    answer();
    await book("NG", "asset=USDT&side=buy&currency=NGN");
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/v1\/crypto\/markets\/NG\/ads\?asset=USDT&side=buy&currency=NGN$/);
    expect(fetchMock.mock.calls[0][1].next.tags).toEqual(["crypto", "crypto:book:NG"]);
  });

  test("addresses: the global market at the root, each country at its lower-case code, only markets shown", async () => {
    answer();
    expect((await marketAt(null))?.market).toBe("WW");
    expect((await marketAt("ng"))?.market).toBe("NG");
    expect(await marketAt("NG")).toBeNull();
    expect(await marketAt("ww")).toBeNull();
    expect(await marketAt("gh")).toBeNull();
    expect(await marketAt("nga")).toBeNull();
    expect([marketPath("WW"), marketPath("NG")]).toEqual(["/", "/ng"]);
  });
});

describe("the small parts of a market page", () => {
  const nigeria = shown.data[1];

  test("the book: its ads, each traded on the customer's BitoCard account in the same market", async () => {
    answer([ad("a"), ad("b", { trader: { nickname: "Traderb", trades_30d: 0, trades_total: 1 } })]);
    const state = pageState(nigeria, shown.assets, {});
    const html = renderToStaticMarkup(await MarketBook({ market: "NG", name: "Nigeria", state }));
    expect(html).toContain("2 ads selling USDT for NGN in Nigeria");
    expect(html).toContain("Tradera");
    expect(html).toMatch(/href="http:\/\/localhost:3000\/account\/crypto\?market=NG&amp;side=buy&amp;asset=USDT&amp;currency=NGN"/);
    expect(html).toContain("Buy USDT");
  });

  test("an empty book offers to clear the filters; an unreachable one says so in its own place", async () => {
    answer([]);
    const filtered = renderToStaticMarkup(await MarketBook({ market: "NG", name: "Nigeria", state: pageState(nigeria, shown.assets, { q: "Ada" }) }));
    expect(filtered).toContain("No ads match your filters");
    expect(filtered).toContain('href="/ng?side=buy&amp;asset=USDT&amp;currency=NGN"');
    fetchMock.mockRejectedValue(new Error("down"));
    expect(renderToStaticMarkup(await MarketBook({ market: "NG", name: "Nigeria", state: pageState(nigeria, shown.assets, {}) }))).toContain("This market cannot be shown right now");
  });

  test("the page's filters stay on the market's own address, in its currencies", () => {
    const state = pageState(nigeria, shown.assets, { currency: "usd", market: "GH", side: "sell" });
    expect([state.path, state.market, state.currency, state.side]).toEqual(["/ng", "", "USD", "sell"]);
    expect(pageState(shown.data[0], shown.assets, { currency: "NGN" }).currency).toBe("USD");
  });

  test("the market tabs and the other markets read the cached markets list", async () => {
    answer();
    const tabs = renderToStaticMarkup(await MarketNav({ current: "NG" }));
    expect(tabs).toContain("Global (USD)");
    expect(tabs).toMatch(/<a [^>]*aria-current="page"[^>]*href="\/ng"|<a [^>]*href="\/ng"[^>]*aria-current="page"/);
    const others = renderToStaticMarkup(await MarketsList({ current: "NG" }));
    expect(others).toContain("Global market");
    expect(others).toContain("3 in USD");
    expect(others).not.toContain("Nigeria");
  });

  test("a trader's card: their trades and the markets they are in, nothing else; an unknown trader is not found", async () => {
    answer();
    const html = renderToStaticMarkup(await TraderCard({ nickname: "TraderA" }));
    expect(html).toContain("TraderA");
    expect(html).toContain('aria-label="Experienced trader"');
    expect(html).toContain('href="/ng?q=TraderA"');
    expect(html).toContain("Global market");
    await expect(TraderCard({ nickname: "Nobody" })).rejects.toThrow();
  });

  test("metadata: one canonical address per market; filtered views are not indexed", () => {
    expect(marketMetadata(nigeria, {})).toMatchObject({ title: "Nigeria crypto market", alternates: { canonical: "/ng" } });
    expect(marketMetadata(nigeria, {}).robots).toBeUndefined();
    expect(marketMetadata(nigeria, { amount: "500" }).robots).toEqual({ index: false, follow: true });
    expect(marketMetadata(shown.data[0], {})).toMatchObject({ title: "Global crypto market", alternates: { canonical: "/" } });
  });
});
