import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ShopCategoryCover } from "@bitocard/api-client/classifieds";
import { setRequest } from "./request";

const { shopBandFor, shopHref, shopNavHref } = await import("@/lib/shop-server");
const { ShopBand } = await import("@/components/store/shop-band");

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const nigeria = { object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN", listings: 12, safe_pay: true, install_prompt: false };
const cover = (slug: string, name: string, listings: number, photo: string | null): ShopCategoryCover => ({
  object: "classified_category_cover",
  slug,
  name,
  icon: "tag",
  listings,
  url: `https://shop.bitocard.com/ng/c/${slug}`,
  photo: photo ? { url: photo, width: 1600, height: 1200, alt: `${name} for sale` } : null,
});
const covers = { object: "list", country: "NG", url: "https://shop.bitocard.com/ng", data: [cover("vehicles", "Vehicles", 1204, "https://media.test/car.jpg"), cover("jobs", "Jobs", 0, null)] };

/** The API: open markets, and the covers of a country. */
const api = (markets = [nigeria], coversStatus = 200) =>
  vi.fn(async (url: string) => {
    if (url.includes("/v1/storefronts/acme")) return reply({ subdomain: "acme", name: "Acme", house: false });
    if (url.includes("/v1/classifieds/markets")) return reply({ object: "list", data: markets, showcase: false });
    if (url.includes("/v1/classifieds/category-covers?country=NG")) return coversStatus === 200 ? reply(covers) : reply({ error: { code: "classifieds_unavailable" } }, coversStatus);
    return reply({ error: { code: "resource_missing" } }, 404);
  });

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("SHOP_URL", "https://shop.bitocard.com");
  setRequest({ host: "bitocard.com" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("BitoCard Shop's band on the home page", () => {
  test("the market's categories with their photos, where the Shop is open and has listings", async () => {
    vi.stubGlobal("fetch", api());
    const band = await shopBandFor("NG");
    expect(band?.market.name).toBe("Nigeria");
    expect(band?.categories.map(category => category.slug)).toEqual(["vehicles", "jobs"]);
  });

  test("nothing without a market, where the Shop is closed or empty, or the API cannot answer", async () => {
    vi.stubGlobal("fetch", api());
    expect(await shopBandFor(null)).toBeNull();
    expect(await shopBandFor("GH")).toBeNull();
    vi.stubGlobal("fetch", api([{ ...nigeria, listings: 0 }]));
    expect(await shopBandFor("NG")).toBeNull();
    vi.stubGlobal("fetch", api([nigeria], 503));
    expect(await shopBandFor("NG")).toBeNull();
  });

  test("never on a reseller's store", async () => {
    setRequest({ host: "acme.bitocard.com" });
    vi.stubGlobal("fetch", api());
    expect(await shopBandFor("NG")).toBeNull();
  });

  test("each category links to it on the Shop with Shop now, under a listing's photo or the bag", () => {
    const html = renderToStaticMarkup(createElement(ShopBand, { country: { code: "NG", name: "Nigeria" }, categories: covers.data, href: (path: string) => `https://shop.test${path}` }));
    expect(html).toContain("Buy and sell near you in Nigeria");
    expect(html).toContain('href="https://shop.test/ng"');
    expect(html).toContain('href="https://shop.test/ng/c/vehicles"');
    expect(html).toContain('href="https://shop.test/ng/c/jobs"');
    expect(html).toContain('src="https://media.test/car.jpg"');
    expect(html).toContain('alt="Vehicles for sale"');
    expect(html.match(/Shop now/g)).toHaveLength(2);
    expect(html).toContain("1,204 ads");
    expect(html).toContain("Be the first to sell");
    expect(html.match(/<img /g)).toHaveLength(1);
  });
});

describe("BitoCard Shop in the header's menu", () => {
  test("the shopper's market where the Shop is open, the Shop's home without one, through the handoff when signed in", async () => {
    vi.stubGlobal("fetch", api());
    expect(await shopNavHref("NG", false)).toBe("https://shop.bitocard.com/ng");
    expect(await shopNavHref("NG", true)).toBe(shopHref("/ng"));
    expect(await shopNavHref(null, false)).toBe("https://shop.bitocard.com/");
  });

  test("nothing where the shopper's market has no Shop, none is open, or on a reseller's store", async () => {
    vi.stubGlobal("fetch", api());
    expect(await shopNavHref("GH", false)).toBeNull();
    vi.stubGlobal("fetch", api([]));
    expect(await shopNavHref(null, false)).toBeNull();
    setRequest({ host: "acme.bitocard.com" });
    vi.stubGlobal("fetch", api());
    expect(await shopNavHref("NG", false)).toBeNull();
  });
});