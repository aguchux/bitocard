import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CryptoMarkets } from "@bitocard/api-client/crypto";
import type { StoreP2pAd } from "@bitocard/api-client/storefront";
import { cached, setRequest } from "./request";

const { book, bookQuery, marketAt, marketPath, publicApi } = await import("@/lib/api");
const { MarketBook } = await import("@/components/book");
const { AccountArea, MarketNav } = await import("@/components/header");
const { default: WalletsPage } = await import("@/app/wallets/page");
const { CryptoActionsProvider } = await import("@afrippa/ui/forms");

/** Renders as the root layout does: the shared trading forms get this site's actions (stubbed here). */
const stub = async () => ({});
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(CryptoActionsProvider, { actions: { postAd: stub, repriceAd: stub, changeAd: stub, chooseNickname: stub }, links: { postAd: "/ads/post" } }, element));
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
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("AFRIPPA_URL", "https://afrippa.com");
  vi.stubEnv("AFRIPPA_SERVER_SECRET", "afrippa-site-secret-afrippa-site-secret-ab");
  setRequest({});
});
afterEach(() => vi.unstubAllEnvs());

const customer = { object: "customer", id: "c1", email: "ada@example.com", name: "Ada Obi", email_verified: true, country: "NG", currency: "NGN", phone: null, phone_verified: false, created_at: "2026-10-01T00:00:00.000Z", two_step: { object: "two_step_state", pending: false, setup_required: false, method: "email", method_not_allowed: false } };
afterEach(() => vi.unstubAllGlobals());

/** Answers the API's public crypto endpoints from fixtures. */
const answer = (ads: StoreP2pAd[] = [ad("a")]) =>
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/v1/afrippa/markets")) return json(shown);
    if (url.includes("/ads?")) return json({ object: "list", market: "NG", asset: "USDT", currency: "NGN", side: "buy", data: ads });
    if (url.endsWith("/v1/afrippa/account")) return json(customer);
    if (url.endsWith("/v1/afrippa/crypto")) return json(overview);
    if (url.endsWith("/v1/afrippa/p2p/profile")) return json({ object: "p2p_profile", nickname: "TraderA", nickname_chosen: true, trades_30d: 1, trades_total: 4 });
    if (url.includes("/v1/afrippa/traders/TraderA")) return json({ object: "p2p_trader", nickname: "TraderA", trades_30d: 4, trades_total: 15, open_ads: 2, markets: ["NG", "WW"], since: "2026-09-01T00:00:00.000Z" });
    return json({ error: { code: "resource_missing" } }, 404);
  });

describe("reading the public data, cached", () => {
  test("every read is signed by this server and kept a minute, tagged; refusals are not kept; an unreachable API never throws", async () => {
    answer();
    expect((await publicApi("/v1/afrippa/markets", ["afrippa:markets"])).ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.cache).toBe("no-store");
    expect(init.headers["afrippa-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(cached[0]).toEqual({ keyParts: ["afrippa-public", "/v1/afrippa/markets"], options: { revalidate: 60, tags: ["afrippa", "afrippa:markets"] } });
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await publicApi("/v1/afrippa/markets")).toEqual({ ok: false, status: 0, code: null });
    expect(await publicApi("/v1/afrippa/traders/nobody")).toEqual({ ok: false, status: 404, code: "resource_missing" });
  });

  test("without AFRIPPA_SERVER_SECRET nothing is signed (the API then answers every Afrippa route as unknown)", async () => {
    vi.stubEnv("AFRIPPA_SERVER_SECRET", "");
    answer();
    await publicApi("/v1/afrippa/markets");
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers["afrippa-signature"]).toBeUndefined();
  });

  test("a book's query is always written in one order, so the same book is one cache entry; each market is tagged", async () => {
    expect(bookQuery({ asset: "USDT", side: "buy", currency: "NGN", fiat: 100000, q: "" })).toBe("asset=USDT&side=buy&currency=NGN&fiat=100000");
    answer();
    await book("NG", "asset=USDT&side=buy&currency=NGN");
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/v1\/afrippa\/markets\/NG\/ads\?asset=USDT&side=buy&currency=NGN$/);
    expect(cached[0].options.tags).toEqual(["afrippa", "afrippa:book:NG"]);
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

  test("the book: its ads, each taken on its own page (an escrow order, signed in), never a session asked here", async () => {
    answer([ad("a"), ad("b", { trader: { nickname: "Traderb", trades_30d: 0, trades_total: 1 } })]);
    const state = pageState(nigeria, shown.assets, {});
    const html = renderToStaticMarkup(await MarketBook({ market: "NG", name: "Nigeria", state }));
    expect(html).toContain("2 ads selling USDT for NGN in Nigeria");
    expect(html).toContain("Tradera");
    expect(html).toContain('href="/take/a"');
    expect(html).toContain("Buy USDT");
    expect(html).not.toContain("Orders open soon");
    expect(html).not.toContain("/signin");
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/v1/afrippa/account")), "no session, no account asked").toBe(false);
  });

  test("the account area: Sign in and Create an account signed out; their wallets, ads and Sign out signed in", async () => {
    answer();
    const out = renderToStaticMarkup(await AccountArea());
    expect(out).toContain('href="/signin?next=%2F"');
    expect(out).toContain('href="/signup"');
    setRequest({}, { afr_session: "bcc_token" });
    const signedIn = renderToStaticMarkup(await AccountArea());
    expect(signedIn).toContain("Sign out (Ada)");
    for (const href of ["/wallets", "/ads", "/orders", "/notifications"]) expect(signedIn).toContain(`href="${href}"`);
    expect(signedIn).not.toContain('href="/trades"');
  });

  test("the account pages ask to sign in first; signed in, the wallets show the coins, with no money pages", async () => {
    await expect(WalletsPage()).rejects.toThrow("NEXT_REDIRECT");
    setRequest({}, { afr_session: "bcc_token" });
    answer();
    const html = render(await WalletsPage());
    expect(html).toContain("You trade as TraderA");
    for (const href of ["/deposit", "/withdraw"]) expect(html).toContain(`href="${href}"`);
    for (const href of ["/add-money", "/cash-out"]) expect(html).not.toContain(`href="${href}"`);
    expect(html).not.toContain("P2P money");
    expect(html).toContain("One question before you trade");
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
