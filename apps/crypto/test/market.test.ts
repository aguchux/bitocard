import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CryptoMarkets } from "@bitocard/api-client/crypto";
import type { StoreP2pAd } from "@bitocard/api-client/storefront";
import { setRequest } from "./request";

const { book, bookQuery, cryptoApi, marketAt, marketPath } = await import("@/lib/api");
const { MarketBook } = await import("@/components/book");
const { AccountArea, MarketNav } = await import("@/components/header");
const { GET: handoffGo } = await import("@/app/handoff/go/route");
const { GET: goPlace } = await import("@/app/go/[place]/route");
const { default: WalletsPage } = await import("@/app/wallets/page");
const { CryptoActionsProvider } = await import("@bitocard/crypto-ui/forms");

/** Renders as the root layout does: the shared trading forms get this site's actions (stubbed here). */
const stub = async () => ({});
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(CryptoActionsProvider, { actions: { takeAd: stub, confirmTrade: stub, postAd: stub, repriceAd: stub, changeAd: stub, chooseNickname: stub }, links: { postAd: "/ads/post", wallet: "/go/wallet" } }, element));
const { MarketsList } = await import("@/components/markets-list");
const { TraderCard } = await import("@/components/trader-card");
const { marketMetadata, pageState } = await import("@/components/market-page");

const shown: CryptoMarkets = {
  object: "list",
  mode: "live",
  assets: ["USDT", "BTC"],
  data: [
    { object: "crypto_market", market: "WW", name: "Global", currencies: ["USD"], ads: { USD: 3 }, install_prompt: false },
    { object: "crypto_market", market: "NG", name: "Nigeria", currencies: ["NGN", "USD"], ads: { NGN: 5, USD: 1 }, install_prompt: true },
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

const overview = {
  object: "crypto_wallets",
  mode: "live",
  country: "NG",
  currency: "NGN",
  enabled: true,
  p2p_enabled: true,
  global_enabled: true,
  verified: true,
  declaration: { version: "2026-10-27", declared: false },
  frozen: false,
  assets: [{ object: "crypto_balance", asset: "USDT", name: "Tether", decimals: 6, enabled: true, available: "12.500000", locked: "0.000000", frozen: "0.000000", withdrawing: "0.000000", total: "12.500000" }],
  cash: { currency: "NGN", proceeds: 50_000_00, wallet: 0, locked: 0, paying_out: 0 },
  usd_cash: { currency: "USD", proceeds: 40_00, wallet: 0, locked: 0, paying_out: 0 },
  other_cash: [{ currency: "GHS", proceeds: 90_00, locked: 0 }],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("STOREFRONT_URL", "https://bitocard.com");
  vi.stubEnv("CRYPTO_URL", "https://crypto.bitocard.com");
  setRequest({});
});
afterEach(() => vi.unstubAllEnvs());

const customer = { object: "customer", id: "c1", email: "ada@example.com", name: "Ada Obi", email_verified: true, country: "NG", currency: "NGN", created_at: "2026-10-01T00:00:00.000Z" };
afterEach(() => vi.unstubAllGlobals());

/** Answers the API's public crypto endpoints from fixtures. */
const answer = (ads: StoreP2pAd[] = [ad("a")]) =>
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/v1/crypto/markets")) return json(shown);
    if (url.includes("/ads?")) return json({ object: "list", market: "NG", asset: "USDT", currency: "NGN", side: "buy", data: ads });
    if (url.endsWith("/v1/store/account")) return json(customer);
    if (url.endsWith("/v1/store/crypto")) return json(overview);
    if (url.endsWith("/v1/store/p2p/profile")) return json({ object: "p2p_profile", nickname: "TraderA", nickname_chosen: true, trades_30d: 1, trades_total: 4 });
    if (url.endsWith("/v1/store/account/handoff")) return json({ object: "customer_handoff", code: "bch_abcdefghijklmnopqrstuvwxyz0123456789", to: "https://ng.bitocard.com" });
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

  test("the book: its ads; signed out, taking one signs in here first and comes back to this very view", async () => {
    answer([ad("a"), ad("b", { trader: { nickname: "Traderb", trades_30d: 0, trades_total: 1 } })]);
    const state = pageState(nigeria, shown.assets, {});
    const html = renderToStaticMarkup(await MarketBook({ market: "NG", name: "Nigeria", state }));
    expect(html).toContain("2 ads selling USDT for NGN in Nigeria");
    expect(html).toContain("Tradera");
    expect(html).toContain('href="/signin?next=%2Fng%3Fside%3Dbuy%26asset%3DUSDT%26currency%3DNGN&amp;for=trade"');
    expect(html).toContain("Buy USDT");
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/v1/store/account")), "no session, no account asked").toBe(false);
  });

  test("signed in, an ad is taken right here: a dialog asking the amount, through this site's own actions", async () => {
    setRequest({}, { bc_customer: "bcc_token" });
    answer();
    const html = render(await MarketBook({ market: "WW", name: "the global market", state: pageState(shown.data[0], shown.assets, {}) }));
    expect(html).toContain("Buy USDT");
    expect(html).toContain('aria-label="Buy from this ad"');
    expect(html).toContain('name="ad_id" value="a"');
    expect(html).not.toContain("/handoff/go");
  });

  test("the account area: Sign in and Trade now signed out; their wallets, ads, trades and Sign out signed in", async () => {
    answer();
    const out = renderToStaticMarkup(await AccountArea());
    expect(out).toContain('href="/signin?next=%2F"');
    expect(out).toContain('href="/signin?next=%2F&amp;for=trade"');
    setRequest({}, { bc_customer: "bcc_token" });
    const signedIn = renderToStaticMarkup(await AccountArea());
    expect(signedIn).toContain("Sign out (Ada)");
    for (const href of ["/wallets", "/ads", "/trades"]) expect(signedIn).toContain(`href="${href}"`);
  });

  test("adding money and the identity check open the customer's account app, signed in there; deposits are on this site", async () => {
    const go = (place: string) => goPlace(new NextRequest(`https://crypto.bitocard.com/go/${place}`), { params: Promise.resolve({ place }) });
    expect((await go("wallet")).headers.get("location")).toBe("https://crypto.bitocard.com/signin?next=%2Fgo%2Fwallet");
    expect((await go("nowhere")).headers.get("location")).toBe("https://crypto.bitocard.com/");
    expect((await go("deposit")).headers.get("location")).toBe("https://crypto.bitocard.com/");
    setRequest({}, { bc_customer: "bcc_token" });
    answer();
    const sent = new URL((await go("verification")).headers.get("location")!);
    expect(sent.origin + sent.pathname).toBe("https://crypto.bitocard.com/handoff/go");
    expect([sent.searchParams.get("to"), sent.searchParams.get("next")]).toEqual(["https://ng.bitocard.com", "/account/verification"]);
  });

  test("the account pages ask to sign in first; signed in, the wallets show every currency of P2P money", async () => {
    await expect(WalletsPage()).rejects.toThrow("NEXT_REDIRECT");
    setRequest({}, { bc_customer: "bcc_token" });
    answer();
    const html = render(await WalletsPage());
    expect(html).toContain("You trade as TraderA");
    expect(html).toContain("GHS");
    for (const href of ["/deposit", "/withdraw", "/cash-out", "/go/wallet"]) expect(html).toContain(`href="${href}"`);
    expect(html).toContain("One question before you trade");
  });

  test("handing off from here: only to BitoCard's own sites, signed in; else sign in first", async () => {
    const go = (query: string) => handoffGo(new NextRequest(`https://crypto.bitocard.com/handoff/go?${query}`));
    const toStore = "to=https%3A%2F%2Fng.bitocard.com&next=%2Faccount%2Fcrypto";
    expect((await go(toStore)).headers.get("location")).toBe(`https://crypto.bitocard.com/signin?next=${encodeURIComponent(`/handoff/go?${toStore}`)}`);
    expect((await go("to=https%3A%2F%2Fevil.example&next=%2Fng")).headers.get("location")).toBe("https://crypto.bitocard.com/ng");
    setRequest({}, { bc_customer: "bcc_token" });
    answer();
    const sent = await go(toStore);
    expect(sent.status).toBe(303);
    expect(sent.headers.get("location")).toBe("https://ng.bitocard.com/handoff#c=bch_abcdefghijklmnopqrstuvwxyz0123456789&n=%2Faccount%2Fcrypto");
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
