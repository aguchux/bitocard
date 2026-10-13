import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { formatCrypto } from "@bitocard/api-client/storefront";
import { setRequest } from "./request";
import { activeTab, appTabs } from "@/components/app/tabs";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { addTestCrypto, changeAd, confirmTrade, findBestPrice, postAd, repriceAd, takeAd } = await import("@/lib/crypto-actions");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const calls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls as unknown as Call[];
const bodyOf = (call: Call) => JSON.parse(String(call[1].body));
const ad = "6b0a8f1e-5f6a-4f0e-9a51-0e4f3f0f1a11";

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session" });
  redirect.mockClear();
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("quick buy and sell", () => {
  test("asks for the best ad for the amount (minor units) and goes to the confirmation", async () => {
    const fetch = vi.fn(async () => reply({ object: "p2p_quote", side: "buy", price: 165000, ad: { id: ad } }));
    vi.stubGlobal("fetch", fetch);
    await expect(findBestPrice({}, form({ side: "buy", asset: "USDT", fiat: "82,500" }))).rejects.toThrow(`redirect:/account/crypto/confirm?ad=${ad}&price=165000&fiat=8250000`);
    expect(calls(fetch)[0][0]).toBe("http://api.test/v1/store/p2p/quote?asset=USDT&side=buy&fiat=8250000");
  });

  test("nobody to trade with, or no amount: says so on the form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "no_matching_ad", message: "Nobody can take this amount right now.", param: "fiat" } }, 409)));
    expect(await findBestPrice({}, form({ side: "sell", asset: "BTC", fiat: "10" }))).toEqual({ error: "Nobody can take this amount right now.", field: "fiat" });
    expect(await findBestPrice({}, form({ side: "buy", asset: "BTC", fiat: "abc" }))).toEqual({ error: "Enter how much you want to trade.", field: "fiat" });
    expect(await takeAd({}, form({ ad_id: ad, price: "165000", fiat: "" }))).toEqual({ error: "Enter an amount.", field: "fiat" });
  });

  test("confirming sends exactly the trade shown (the price seen guards against changes) and opens its receipt", async () => {
    const fetch = vi.fn(async () => reply({ object: "p2p_trade", id: "t1" }, 201));
    vi.stubGlobal("fetch", fetch);
    await expect(confirmTrade({}, form({ ad_id: ad, price: "165000", fiat: "8250000" }))).rejects.toThrow("redirect:/account/crypto/trades/t1?done=1");
    expect(bodyOf(calls(fetch)[0])).toEqual({ ad_id: ad, price: 165000, fiat: 8250000 });
  });

  test("too little money points to the wallet; a changed price is shown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "insufficient_funds", message: "Your NGN balance is too low." } }, 402)));
    expect(await confirmTrade({}, form({ ad_id: ad, price: "1", fiat: "1" }))).toEqual({ error: "Your NGN balance is too low.", field: "funds" });
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { code: "price_changed", message: "The price of this ad changed." } }, 409)));
    expect(await confirmTrade({}, form({ ad_id: ad, price: "1", fiat: "1" }))).toEqual({ error: "The price of this ad changed." });
  });
});

describe("ads", () => {
  test("posting converts the price and limits to minor units and keeps the amount as typed", async () => {
    const fetch = vi.fn(async () => reply({ object: "p2p_ad", id: ad }, 201));
    vi.stubGlobal("fetch", fetch);
    await expect(postAd({}, form({ side: "sell", asset: "USDT", price: "1,650.50", amount: "100.5", min_fiat: "1,000", max_fiat: "500000", terms: "" }))).rejects.toThrow("redirect:/account/crypto/ads?posted=1");
    expect(bodyOf(calls(fetch)[0])).toEqual({ side: "sell", asset: "USDT", price: 165050, amount: "100.5", min_fiat: 100000, max_fiat: 50000000 });
    expect(await postAd({}, form({ side: "buy", asset: "USDT", price: "1650", amount: "-1", min_fiat: "1", max_fiat: "2" }))).toEqual({ error: "Enter how much to trade.", field: "amount" });
  });

  test("pause, resume, close and a new price", async () => {
    const fetch = vi.fn(async () => reply({ object: "p2p_ad", id: ad }));
    vi.stubGlobal("fetch", fetch);
    await changeAd(form({ id: ad, op: "pause" }));
    await changeAd(form({ id: ad, op: "cancel" }));
    expect(calls(fetch).map(call => [call[1].method, call[0]])).toEqual([
      ["PATCH", `http://api.test/v1/store/p2p/ads/${ad}`],
      ["POST", `http://api.test/v1/store/p2p/ads/${ad}/cancel`],
    ]);
    expect(bodyOf(calls(fetch)[0])).toEqual({ status: "paused" });
    expect((await repriceAd({}, form({ id: ad, price: "1700" }))).notice).toBe("Price updated.");
    expect(bodyOf(calls(fetch)[2])).toEqual({ price: 170000 });
  });

  test("sandbox test crypto", async () => {
    const fetch = vi.fn(async () => reply({ object: "crypto_balance" }, 201));
    vi.stubGlobal("fetch", fetch);
    expect((await addTestCrypto({}, form({ asset: "BTC", amount: "0.5" }))).notice).toBe("Added 0.5 test BTC.");
    expect(bodyOf(calls(fetch)[0])).toEqual({ asset: "BTC", amount: "0.5" });
  });
});

describe("display", () => {
  test("crypto amounts drop trailing zeros, keep two places for stablecoins and group thousands", () => {
    expect(formatCrypto("49.900000", "USDT")).toBe("49.90 USDT");
    expect(formatCrypto("0.00019960", "BTC")).toBe("0.0001996 BTC");
    expect(formatCrypto("12500.000000")).toBe("12,500");
  });

  test("Crypto is its own tab, with its pages", () => {
    expect(appTabs.map(tab => tab.label)).toContain("Crypto");
    expect(activeTab("/account/crypto")).toBe("/account/crypto");
    expect(activeTab("/account/crypto/trades/abc")).toBe("/account/crypto");
  });
});
