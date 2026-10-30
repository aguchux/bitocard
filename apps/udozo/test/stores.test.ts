// Resellers' stores in Udozo's app (docs/UDOZO_SPINOFF_PLAN.md, step 4): which host is a store, the proxy's routing (a
// sandbox subdomain, a live store's own domain, a live store's subdomain sending visitors on), the store named to the
// API, signing in through udozo.com's handoff, and the store's pages.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ResaleStoreListing, ResolvedSection } from "@bitocard/api-client/storefront";
import { setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url), notFound: () => redirect("not-found"), permanentRedirect: (url: string) => redirect(url), useRouter: () => ({ push: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { classifyHost, indexable, storeRoute, storeHeader, storeOriginHeader, storePathHeader } = await import("@/lib/store-host");
const { proxy } = await import("@/proxy");
const { customerApi } = await import("@/lib/customer");
const { continueSignIn } = await import("@/lib/handoff-actions");
const { requireStore, requireShopper, storeHome } = await import("@/lib/store");
const { buyResale } = await import("@/lib/purchase-actions");
const { GET: storeSignIn } = await import("@/app/store/[store]/signin/route");
const { GET: storeRobots } = await import("@/app/store/[store]/robots.txt/route");
const { StoreSections } = await import("@/components/store/store-sections");

type Call = { url: string; method: string; headers: Headers; body: unknown };
let calls: Call[];
let reply: (url: string, method: string) => Response | null;

const site = "https://udozo.com";
const store = (overrides: Record<string, unknown> = {}) => ({ object: "storefront", name: "Gadget Hub", subdomain: "gadgets", branding: { logo_url: null, primary_color: null, accent_color: null }, design: null, country: "NG", currency: "NGN", checkout_mode: "test", house: false, white_label: false, domain: null, ...overrides });
/** A store's request as the proxy passes it on. */
const onStore = (cookies: Record<string, string> = {}, origin = "https://gadgets.udozo.com", path = "/") => setRequest({ host: new URL(origin).host, [storeHeader]: "gadgets", [storeOriginHeader]: origin, [storePathHeader]: path }, cookies);
const requestHeader = (response: Response, name: string) => response.headers.get(`x-middleware-request-${name}`);

beforeEach(() => {
  vi.stubEnv("UDOZO_URL", site);
  vi.stubEnv("API_URL", "https://api.test");
  setRequest({ host: "udozo.com" });
  redirect.mockClear();
  calls = [];
  reply = () => null;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit & { next?: unknown } = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : null });
    return reply(url, method) ?? Response.json({ error: { code: "resource_missing" } }, { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("which host is a store", () => {
  test("udozo.com, its www and previews are the marketplace; a subdomain or another domain is a store", () => {
    expect(classifyHost("udozo.com", site)).toEqual({ kind: "marketplace" });
    expect(classifyHost("www.udozo.com", site)).toEqual({ kind: "marketplace" });
    expect(classifyHost("udozo-git-main.vercel.app", site)).toEqual({ kind: "marketplace" });
    expect(classifyHost("localhost:3007", "http://localhost:3007")).toEqual({ kind: "marketplace" });
    expect(classifyHost("gadgets.udozo.com", site)).toEqual({ kind: "subdomain", subdomain: "gadgets" });
    expect(classifyHost("gadgets.localhost:3007", "http://localhost:3007")).toEqual({ kind: "subdomain", subdomain: "gadgets" });
    expect(classifyHost("Shop.Example.com.", site)).toEqual({ kind: "domain", domain: "shop.example.com" });
    // Never looked up: odd names, IP addresses, other ports, deeper subdomains.
    for (const host of ["a.b.udozo.com", "-x.udozo.com", "10.0.0.1", "shop.example.com:8443", "", null]) expect(classifyHost(host, site)).toEqual({ kind: "marketplace" });
  });

  test("a live store with a domain is served there only; Next's own addresses are never prefixed twice", () => {
    const live = { subdomain: "gadgets", checkout_mode: "live" as const, domain: "gadgets.ng" };
    expect(storeRoute({ kind: "subdomain", subdomain: "gadgets" }, live, "/l/12-tv", "?x=1")).toEqual({ redirect: "https://gadgets.ng/l/12-tv?x=1" });
    expect(storeRoute({ kind: "domain", domain: "gadgets.ng" }, live, "/l/12-tv", "")).toEqual({ rewrite: "/store/gadgets/l/12-tv" });
    expect(storeRoute({ kind: "subdomain", subdomain: "gadgets" }, { ...live, checkout_mode: "test" }, "/", "")).toEqual({ rewrite: "/store/gadgets" });
    expect(storeRoute({ kind: "domain", domain: "gadgets.ng" }, live, "/store/gadgets/opengraph-image", "?v=1")).toEqual({ rewrite: "/store/gadgets/opengraph-image?v=1" });
    expect(storeRoute({ kind: "domain", domain: "gadgets.ng" }, live, "/store/other/x", "")).toEqual({ rewrite: "/store/gadgets/store/other/x" });
  });

  test("only a live store on its own domain is indexed", () => {
    expect(indexable({ checkout_mode: "live" }, "https://gadgets.ng", site)).toBe(true);
    expect(indexable({ checkout_mode: "test" }, "https://gadgets.ng", site)).toBe(false);
    expect(indexable({ checkout_mode: "live" }, "https://gadgets.udozo.com", site)).toBe(false);
  });
});

describe("the proxy", () => {
  test("a sandbox subdomain is rewritten to the store's pages, naming the store, its origin and the path asked for", async () => {
    reply = url => (url === "https://api.test/v1/storefronts/gadgets" ? Response.json(store()) : null);
    const response = await proxy(new NextRequest("https://gadgets.udozo.com/listings?q=tv", { headers: { [storeHeader]: "forged", host: "gadgets.udozo.com" } }));
    expect(new URL(response.headers.get("x-middleware-rewrite")!).pathname).toBe("/store/gadgets/listings");
    expect(requestHeader(response, storeHeader)).toBe("gadgets");
    expect(requestHeader(response, storeOriginHeader)).toBe("https://gadgets.udozo.com");
    expect(requestHeader(response, storePathHeader)).toBe("/listings?q=tv");
  });

  test("a live store's subdomain sends visitors to its domain; its domain is served", async () => {
    reply = url => {
      if (url === "https://api.test/v1/storefronts/livestore") return Response.json(store({ subdomain: "livestore", checkout_mode: "live", domain: "livestore.ng" }));
      if (url === "https://api.test/v1/storefronts/domains/livestore.ng") return Response.json({ object: "storefront_domain", domain: "livestore.ng", subdomain: "livestore" });
      return null;
    };
    const moved = await proxy(new NextRequest("https://livestore.udozo.com/l/5-tv", { headers: { host: "livestore.udozo.com" } }));
    expect([moved.status, moved.headers.get("location")]).toEqual([308, "https://livestore.ng/l/5-tv"]);
    const served = await proxy(new NextRequest("https://livestore.ng/", { headers: { host: "livestore.ng" } }));
    expect(new URL(served.headers.get("x-middleware-rewrite")!).pathname).toBe("/store/livestore");
    expect(requestHeader(served, storeOriginHeader)).toBe("https://livestore.ng");
  });

  test("an unknown store is not open; an unreachable API is a 503, never remembered", async () => {
    const missing = await proxy(new NextRequest("https://nosuch.udozo.com/", { headers: { host: "nosuch.udozo.com" } }));
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("This store is not open");
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    expect((await proxy(new NextRequest("https://later.udozo.com/", { headers: { host: "later.udozo.com" } }))).status).toBe(503);
  });

  test("udozo.com never serves store pages, and a store header the browser sent never reaches a page", async () => {
    expect((await proxy(new NextRequest("https://udozo.com/store/gadgets/listings", { headers: { host: "udozo.com" } }))).status).toBe(404);
    const response = await proxy(new NextRequest("https://udozo.com/api/account/x", { headers: { host: "udozo.com", [storeHeader]: "gadgets", [storeOriginHeader]: "https://evil.example" } }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-override-headers")?.split(",")).not.toContain(storeHeader);
    expect(requestHeader(response, storeHeader)).toBeNull();
  });
});

describe("on a store", () => {
  test("the API is told which store, with the shopper's session from the store's own cookie", async () => {
    onStore({ udz_customer: "bcc_store" });
    reply = () => Response.json({ object: "customer" });
    await customerApi("GET", "/v1/store/account");
    expect(calls[0]!.headers.get("bitocard-store")).toBe("gadgets");
    expect(calls[0]!.headers.get("bitocard-customer-session")).toBe("bcc_store");
  });

  test("signing in goes through udozo.com's handoff to this store's origin, coming back to the page", async () => {
    onStore({}, "https://gadgets.ng");
    const response = await storeSignIn(new Request("https://gadgets.ng/store/gadgets/signin?next=%2Fl%2F12-tv"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://udozo.com/handoff/go?to=https%3A%2F%2Fgadgets.ng&next=%2Fl%2F12-tv");
    const outside = await storeSignIn(new Request("https://gadgets.ng/store/gadgets/signin?next=%2F%2Fevil.com"));
    expect(outside.headers.get("location")).toContain("&next=%2F");
    expect(outside.headers.get("location")).not.toContain("evil");
  });

  test("the handoff's code is exchanged naming the store's origin, and lands on the page asked for", async () => {
    onStore({}, "https://gadgets.ng");
    reply = () => Response.json({ customer: { email_verified: false }, session: { token: "bcc_new" } });
    expect(await continueSignIn(`bch_${"a".repeat(30)}`, "/listings")).toEqual({ ok: true, next: "/listings" });
    expect(calls[0]!.body).toEqual({ code: `bch_${"a".repeat(30)}`, origin: "https://gadgets.ng" });
    setRequest({ host: "udozo.com" });
    await continueSignIn(`bch_${"b".repeat(30)}`, "/ng");
    expect(calls[1]!.body).toMatchObject({ origin: "https://udozo.com" });
  });

  test("a page trusts the proxy's store, not its address alone; account pages need a signed-in shopper", async () => {
    onStore();
    reply = url => (url.startsWith("https://api.test/v1/storefronts/gadgets") ? Response.json(store()) : null);
    expect((await requireStore("gadgets")).name).toBe("Gadget Hub");
    await expect(requireStore("other")).rejects.toThrow("redirect:not-found");
    setRequest({ host: "udozo.com" });
    await expect(requireStore("gadgets")).rejects.toThrow("redirect:not-found");
    onStore();
    await expect(requireShopper("gadgets", "/account/purchases")).rejects.toThrow("redirect:/signin?next=%2Faccount%2Fpurchases");
  });

  test("the home page is the store's own, a preview read fresh", async () => {
    reply = () => Response.json({ object: "store_home", sections: [] });
    await storeHome("gadgets");
    await storeHome("gadgets", "1800000000000.abcdefghijklmnopqrstuvwx");
    expect(calls.map(call => call.url)).toEqual(["https://api.test/v1/store/resale/home?store=gadgets", "https://api.test/v1/store/resale/home?store=gadgets&preview=1800000000000.abcdefghijklmnopqrstuvwx"]);
  });

  test("buying pays the total the shopper was shown, once per form, on this store", async () => {
    onStore({ udz_customer: "bcc_store" });
    reply = () => Response.json({ id: "o1" });
    await buyResale({ ref: 12, quantity: 2, fulfilment: "meet_up" }, 2_100_000, "nonce-12345678");
    expect(calls[0]!.url).toBe("https://api.test/v1/store/resale/orders");
    expect(calls[0]!.body).toEqual({ ref: 12, quantity: 2, fulfilment: "meet_up", expected_total: 2_100_000 });
    expect(calls[0]!.headers.get("idempotency-key")).toBe("nonce-12345678");
    expect(calls[0]!.headers.get("bitocard-store")).toBe("gadgets");
  });

  test("robots: a test store is never crawled; a live store on its domain is, but not its account pages", async () => {
    onStore();
    reply = () => Response.json(store());
    expect(await (await storeRobots()).text()).toBe("User-agent: *\nDisallow: /\n");
    onStore({}, "https://gadgets.ng");
    reply = () => Response.json(store({ checkout_mode: "live", domain: "gadgets.ng" }));
    const text = await (await storeRobots()).text();
    expect(text).toContain("Allow: /");
    expect(text).toContain("Disallow: /account");
  });
});

describe("the store's home page", () => {
  const listing: ResaleStoreListing = {
    object: "resale_store_listing",
    id: "l1",
    ref: 12,
    slug: "hisense-tv",
    title: "Hisense 50 inch TV",
    cover: null,
    currency: "NGN",
    price: 2_000_000,
    condition: "new",
    area: null,
    delivery: "none",
    note: null,
    available: 1,
    supplier: { id: "s1", name: "Chinedu O.", member_since: "2026-01-01", badges: [] },
  } as unknown as ResaleStoreListing;
  const section = (type: string, data: unknown, extra: Record<string, unknown> = {}) => ({ id: type, type, span: { desktop: 12, tablet: 6 }, hidden: false, title: type, subtitle: "", ...extra, data }) as unknown as ResolvedSection;

  test("sections with nothing on sale are left out; every listing names its supplier", () => {
    const html = renderToStaticMarkup(
      createElement(StoreSections, {
        design: null,
        sections: [
          section("hero", { featured: [], listings: [listing], categories: [] }, { accent: "", search: true, categoryChips: false }),
          section("listing_rail", { listings: [listing], total: 1 }, { source: "newest", category: null, viewAllHref: null }),
          section("listing_grid", { listings: [], total: 0 }, { category: null }),
          section("resale_categories", { categories: [] }),
        ],
      }),
    );
    expect(html).toContain("Hisense 50 inch TV");
    expect(html).toContain("Chinedu O.");
    expect(html).toContain('href="/l/12-hisense-tv"');
    expect(html).not.toContain('id="grid-listing_grid"');
    expect(html).not.toContain("Nothing on sale here right now");
  });

  test("a store with nothing on sale says so, with search", () => {
    const html = renderToStaticMarkup(createElement(StoreSections, { design: null, sections: [section("hero", { featured: [] }, { accent: "", search: false, categoryChips: false })] }));
    expect(html).toContain("Nothing on sale here right now");
    expect(html).toContain('action="/listings"');
  });
});
