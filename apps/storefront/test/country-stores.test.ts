// Country-localised bitocard.com stores (docs/BITOCARD_COUNTRY_STORES_PLAN.md), Stage 4: storefront routing and the
// root redirect. countryStoreFor() picks a market's live country store out of the countries list; chooseMarket()
// sends the shopper there instead of just remembering the market; onResellerStore() reads the API's house flag.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string, type?: string) => revalidatePath(path, type) }));

const { countryStoreFor } = await import("@/lib/market");
const { chooseMarket } = await import("@/app/(store)/market-action");
const { onResellerStore } = await import("@/lib/store");

const countries = [
  { code: "NG", name: "Nigeria", products: 40, store_subdomain: "ng" },
  { code: "GH", name: "Ghana", products: 9, store_subdomain: null },
];

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  redirect.mockClear();
  revalidatePath.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("countryStoreFor", () => {
  test("the market's own subdomain, or null without one, without a code, or for an unlisted country", () => {
    expect(countryStoreFor(countries, "NG")).toBe("ng");
    expect(countryStoreFor(countries, "GH")).toBeNull();
    expect(countryStoreFor(countries, "KE")).toBeNull();
    expect(countryStoreFor(countries, null)).toBeNull();
    expect(countryStoreFor(countries, undefined)).toBeNull();
  });
});

describe("chooseMarket", () => {
  test("a market with a live country store redirects there instead of setting the cookie", async () => {
    setRequest({ host: "bitocard.com" });
    await expect(chooseMarket("NG", "ng")).rejects.toThrow("redirect:https://ng.bitocard.com");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("a market with no country store yet just remembers the choice, as before", async () => {
    setRequest({ host: "bitocard.com" });
    await chooseMarket("GH", null);
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  test("staying global never redirects, even if a subdomain is somehow sent", async () => {
    setRequest({ host: "bitocard.com" });
    await chooseMarket("global", "ng");
    expect(redirect).not.toHaveBeenCalled();
  });

  test("a tampered, invalid subdomain is never trusted into a redirect", async () => {
    setRequest({ host: "bitocard.com" });
    await chooseMarket("NG", "https://evil.example");
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});

describe("onResellerStore", () => {
  test("true on a reseller's hosted store, false on a market's own country store or bitocard.com itself", async () => {
    setRequest({ host: "bitocard.com" });
    expect(await onResellerStore()).toBe(false);

    setRequest({ host: "ng.bitocard.com" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ object: "storefront", name: "BitoCard NG", subdomain: "ng", house: true }), { status: 200 })));
    expect(await onResellerStore()).toBe(false);

    setRequest({ host: "acme.bitocard.com" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ object: "storefront", name: "Acme", subdomain: "acme", house: false }), { status: 200 })));
    expect(await onResellerStore()).toBe(true);
  });
});
