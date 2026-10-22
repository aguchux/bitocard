import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";
import { formatFace, localFace } from "@bitocard/api-client/storefront";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { currentMarket, inMarket, marketIsGlobal, marketLocked, withPrices } = await import("@/lib/market");
const { setCountry, signUp } = await import("@/lib/account-actions");
const { priceLabel } = await import("@/components/store/product-card");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const bodyOf = (call: Call) => JSON.parse(String(call[1].body));
const customer = (country: string | null, currency: string | null) => ({ object: "customer", id: "c1", email: "a@example.com", name: "Ada", email_verified: true, country, currency, created_at: "2026-10-10T00:00:00Z" });

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  redirect.mockClear();
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the signed-in customer's country", () => {
  test("is their market on bitocard.com unless they chose to stay global; the header always lets them change it", async () => {
    setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(customer("NG", "NGN"))));
    expect(await currentMarket()).toBe("NG");
    expect(await marketLocked()).toBe(false);

    // Having chosen to stay global (the market dialog's "Stay global", or the country store's "Shop globally" link),
    // that standing choice wins over their account's own country, and they browse in US dollars.
    setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session", bc_market: "global" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(customer("NG", "NGN"))));
    expect(await currentMarket()).toBe("global");
    expect(await marketLocked()).toBe(false);
  });

  test("signed out (or an older account without one), the cookie's market stands and can be changed", async () => {
    setRequest({ host: "bitocard.com" }, { bc_market: "GH" });
    vi.stubGlobal("fetch", vi.fn(async () => reply({})));
    expect([await currentMarket(), await marketLocked()]).toEqual(["GH", false]);
    setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session", bc_market: "GH" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(customer(null, null))));
    expect([await currentMarket(), await marketLocked()]).toEqual(["GH", false]);
  });

  test("product reads ask for prices in their currency; other reads do not (they take no currency)", async () => {
    setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(customer("GH", "GHS"))));
    expect(await inMarket("/v1/store/products?sort=popular")).toBe("/v1/store/products?sort=popular&market=GH&currency=GHS");
    expect(await inMarket("/v1/store/home")).toBe("/v1/store/home?market=GH&currency=GHS");
    expect(await withPrices("/v1/store/products/gift_cards%3AUS%3Aamazon")).toBe("/v1/store/products/gift_cards%3AUS%3Aamazon?currency=GHS");
    expect(await inMarket("/v1/store/navigation")).toBe("/v1/store/navigation?market=GH");
    expect(await inMarket("/v1/store/brands?limit=24")).toBe("/v1/store/brands?limit=24&market=GH");
  });

  test("staying global: prices show in US dollars (every customer holds a US dollar wallet), and the market is left out", async () => {
    setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session", bc_market: "global" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(customer("GH", "GHS"))));
    expect(await marketIsGlobal()).toBe(true);
    expect(await inMarket("/v1/store/products?sort=popular")).toBe("/v1/store/products?sort=popular&currency=USD");
    expect(await withPrices("/v1/store/home")).toBe("/v1/store/home?currency=USD");

    // Signed out, with no market chosen yet (the dialog has not been answered), bitocard.com itself is also US dollars.
    setRequest({ host: "bitocard.com" });
    vi.stubGlobal("fetch", vi.fn(async () => reply({})));
    expect(await currentMarket()).toBe(null);
    expect(await withPrices("/v1/store/home")).toBe("/v1/store/home?currency=USD");
  });

  test("sign-up sends the country chosen; an older account sets its own once in Account", async () => {
    setRequest({ host: "bitocard.com" });
    const fetch = vi.fn(async () => reply({ customer: customer("GH", "GHS"), session: { token: "bcc_new" } }, 201));
    vi.stubGlobal("fetch", fetch);
    // Keeping the session needs the real cookie store; only what is sent matters here.
    await signUp({}, form({ name: "Kofi", email: "k@example.com", password: "correct horse battery", country: "GH", next: "/account" })).catch(() => null);
    expect(bodyOf((fetch.mock.calls as unknown as Call[])[0])).toMatchObject({ country: "GH" });

    setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session" });
    const set = vi.fn(async () => reply({ error: { code: "country_locked", message: "Your country is set for good: your wallet and payments are in its currency.", param: "country" } }, 409));
    vi.stubGlobal("fetch", set);
    expect(await setCountry({}, form({ country: "NG" }))).toEqual({ error: "Your country is set for good: your wallet and payments are in its currency.", field: "country" });
    expect((set.mock.calls as unknown as Call[])[0][0]).toBe("http://api.test/v1/store/account/profile");
  });
});

const storefront = (body: Record<string, unknown>) => reply({ object: "storefront", name: "BitoCard Ghana", subdomain: "gh", branding: {}, checkout_mode: "live", ...body });

describe("a market's own country store", () => {
  test("is the market, locked: the dialog never asks there, and its own currency prices every shopper, signed in or not", async () => {
    setRequest({ host: "gh.bitocard.com" });
    vi.stubGlobal("fetch", vi.fn(async () => storefront({ house: true, country: "GH", currency: "GHS" })));
    expect(await currentMarket()).toBe("GH");
    expect(await marketLocked()).toBe(true);
    expect(await marketIsGlobal()).toBe(false);
    expect(await withPrices("/v1/store/home")).toBe("/v1/store/home?currency=GHS");

    // A signed-in customer from another market browsing here still sees this store's own currency: it is the same
    // store for every shopper, not personalised by account.
    setRequest({ host: "gh.bitocard.com" }, { bc_customer: "bcc_session" });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/v1/store/account") ? reply(customer("NG", "NGN")) : storefront({ house: true, country: "GH", currency: "GHS" }))));
    expect(await currentMarket()).toBe("GH");
    expect(await withPrices("/v1/store/home")).toBe("/v1/store/home?currency=GHS");
  });
});

describe("a reseller's hosted store", () => {
  test("has no market to choose: the API keeps it to the reseller's own country on its own, and prices are its face values", async () => {
    setRequest({ host: "acme.bitocard.com" });
    vi.stubGlobal("fetch", vi.fn(async () => storefront({ name: "Acme", subdomain: "acme", house: false, country: "NG", currency: "NGN" })));
    expect(await currentMarket()).toBe("global");
    expect(await marketLocked()).toBe(true);
    expect(await withPrices("/v1/store/home")).toBe("/v1/store/home");
  });
});

describe("local prices", () => {
  const product = { from: 2500, to: 10000, face_currency: "USD", price: { currency: "NGN", from: 3806300, to: 15225000, rate: "1522.5" } };

  test("cards show the customer's currency, signed out the face value", () => {
    expect(priceLabel({ ...product } as never)).toBe(`From ${formatFace(3806300, "NGN")}`);
    expect(priceLabel({ ...product, price: null } as never)).toBe(`From ${formatFace(2500, "USD")}`);
  });

  test("any face value converts as the API does: at its rate, rounded up to a whole unit", () => {
    expect(localFace(2500, product)).toEqual({ amount: 3806300, currency: "NGN" });
    expect(localFace(5000, product)).toEqual({ amount: 7612500, currency: "NGN" });
    expect(localFace(2500, { ...product, price: null })).toBeNull();
    expect(localFace(500000, { face_currency: "NGN", price: { currency: "NGN", from: 500000, to: 500000, rate: "1" } })).toBeNull();
  });
});
