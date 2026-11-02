// udozo.com's sitemaps, built from live data: the real pages themselves while they fit one file, then an index of every
// country's files, nothing cut off, and a failing API answers 503 (never a shorter sitemap, which would read as those
// pages being gone).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ShopSitemap } from "@bitocard/api-client/classifieds";
import { countryEntries, countryFiles, pagesInFile, readSitemapFile, sitemapLimit } from "@/lib/sitemap";

const { GET: index } = await import("@/app/sitemap.xml/route");
const { GET: main } = await import("@/app/sitemap-main.xml/route");
const { GET: file } = await import("@/app/sitemaps/[file]/route");

const site = "https://udozo.com";
const sitemap = (overrides: Partial<ShopSitemap> = {}): ShopSitemap => ({
  object: "classified_sitemap",
  country: "NG",
  updated_at: "2026-11-01T09:00:00.000Z",
  categories: [{ slug: "mobile-phones", listings: 9, updated_at: "2026-11-01T09:00:00.000Z" }],
  places: [{ state: "lagos", area: null, listings: 9, updated_at: "2026-11-01T09:00:00.000Z" }],
  category_places: [{ state: "lagos", area: "ikeja", category: "mobile-phones", listings: 6, updated_at: "2026-11-01T08:00:00.000Z" }],
  listing_pages: [
    { after: 0, listings: 5000, updated_at: "2026-10-30T00:00:00.000Z" },
    { after: 104000, listings: 12, updated_at: "2026-11-01T09:00:00.000Z" },
  ],
  ...overrides,
});
const listings = { object: "classified_sitemap_listings", country: "NG", listings: [{ ref: 104001, slug: "tv", updated_at: "2026-11-01T09:00:00.000Z", images: ["https://media.test/a.jpg"] }], next_after: null };

let reply: (path: string) => Response;
const calls: string[] = [];
const open = () => (reply = path => {
  if (path === "/v1/classifieds/markets") return Response.json({ object: "list", showcase: true, data: [{ country: "NG" }, { country: "GH" }] });
  if (path === "/v1/classifieds/showcase") return Response.json({ categories: [{ slug: "electronics" }] });
  if (path.startsWith("/v1/classifieds/sitemap/listings")) return Response.json(listings);
  if (path === "/v1/classifieds/sitemap?country=GH") return Response.json(sitemap({ country: "GH", listing_pages: [] }));
  if (path === "/v1/classifieds/sitemap?country=NG") return Response.json(sitemap());
  return Response.json({ error: { code: "classifieds_unavailable" } }, { status: 404 });
});

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("UDOZO_URL", site);
  vi.stubEnv("API_URL", "https://api.test");
  open();
  vi.stubGlobal("fetch", async (url: string) => {
    const { pathname, search } = new URL(url);
    calls.push(pathname + search);
    return reply(pathname + search);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const request = (name: string) => file(new Request(`${site}/sitemaps/${name}`), { params: Promise.resolve({ file: name }) });

describe("the sitemap", () => {
  const locations = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);

  test("is the real pages themselves while they fit in one file: every market's, then its listings", async () => {
    const response = await index();
    const xml = await response.text();
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
    expect(xml).toContain("<urlset");
    expect(xml).not.toContain("<sitemapindex");
    const found = locations(xml);
    for (const path of ["/", "/start-here", "/legal/terms", "/c/electronics", "/ng", "/ng/c/mobile-phones", "/ng/lagos/ikeja/mobile-phones", "/gh", "/gh/c/mobile-phones", "/ng/l/104001-tv"]) expect(found).toContain(`${site}${path}`);
    expect(found.filter(loc => loc!.includes("/sitemaps/"))).toEqual([]);
    expect(xml).toContain("<image:loc>https://media.test/a.jpg</image:loc>");
    expect(calls).toContain("/v1/classifieds/sitemap/listings?country=NG&after=104000");
  });

  test("a new market joins by itself", async () => {
    const before = open();
    reply = path => (path === "/v1/classifieds/markets" ? Response.json({ object: "list", showcase: true, data: [{ country: "NG" }, { country: "GH" }, { country: "KE" }] }) : path.endsWith("=KE") ? Response.json(sitemap({ country: "KE", listing_pages: [] })) : before(path));
    expect(await (await index()).text()).toContain(`<loc>${site}/ke</loc>`);
  });

  test("past one file's limit it becomes an index of every file, with when each last changed", async () => {
    const before = open();
    reply = path =>
      path === "/v1/classifieds/sitemap?country=NG"
        ? Response.json(sitemap({ listing_pages: [{ after: 0, listings: 49_999, updated_at: "2026-10-30T00:00:00.000Z" }, { after: 104000, listings: 12, updated_at: "2026-11-01T09:00:00.000Z" }] }))
        : before(path);
    const xml = await (await index()).text();
    expect(xml).toContain("<sitemapindex");
    expect(locations(xml)).toEqual([`${site}/sitemap-main.xml`, `${site}/sitemaps/ng-pages-0.xml`, `${site}/sitemaps/ng-listings-0.xml`, `${site}/sitemaps/ng-listings-104000.xml`, `${site}/sitemaps/gh-pages-0.xml`]);
    expect(xml).toContain(`<loc>${site}/sitemaps/ng-listings-104000.xml</loc><lastmod>2026-11-01T09:00:00.000Z</lastmod>`);
  });

  test("answers 503 and is never kept while the API cannot say, for any market or listing file", async () => {
    reply = () => new Response("down", { status: 502 });
    const down = await index();
    expect([down.status, down.headers.get("cache-control"), down.headers.get("retry-after")]).toEqual([503, "no-store", "600"]);
    const before = open();
    reply = path => (path.endsWith("=GH") ? new Response("down", { status: 500 }) : before(path));
    expect((await index()).status).toBe(503);
    expect((await main()).status).toBe(200);
    reply = path => (path.includes("after=104000") ? new Response("down", { status: 500 }) : before(path));
    expect((await index()).status).toBe(503);
    reply = path => (path === "/v1/classifieds/showcase" ? new Response("down", { status: 500 }) : before(path));
    expect((await index()).status).toBe(503);
    reply = () => new Response("down", { status: 500 });
    expect((await main()).status).toBe(503);
  });
});

describe("a country's files", () => {
  test("its pages", async () => {
    const response = await request("ng-pages-0.xml");
    const xml = await response.text();
    expect(response.headers.get("content-type")).toContain("application/xml");
    for (const path of ["/ng", "/ng/c/mobile-phones", "/ng/lagos", "/ng/lagos/ikeja/mobile-phones"]) expect(xml).toContain(`<loc>${site}${path}</loc>`);
    expect(xml).toContain(`<loc>${site}/ng/lagos/ikeja/mobile-phones</loc><lastmod>2026-11-01T08:00:00.000Z</lastmod>`);
  });

  test("its listings, from where the file starts", async () => {
    const xml = await (await request("ng-listings-104000.xml")).text();
    expect(calls).toEqual(["/v1/classifieds/sitemap/listings?country=NG&after=104000"]);
    expect(xml).toContain(`<loc>${site}/ng/l/104001-tv</loc>`);
    expect(xml).toContain("<image:loc>https://media.test/a.jpg</image:loc>");
  });

  test("a closed country, a file past the end and odd names are not found; an unreachable API is only unavailable", async () => {
    expect((await request("ke-pages-0.xml")).status).toBe(404);
    expect((await request("ng-pages-1.xml")).status).toBe(404);
    for (const name of ["NG-pages-0.xml", "ng.xml", "ng-pages-x.xml", "../ng-pages-0.xml", "ng-listings-1.xml.gz"]) {
      expect(readSitemapFile(name)).toBeNull();
      expect((await request(name)).status).toBe(404);
    }
    reply = () => new Response("down", { status: 503 });
    expect((await request("ng-pages-0.xml")).status).toBe(503);
    vi.stubGlobal("fetch", async () => {
      throw new Error("unreachable");
    });
    expect((await request("ng-listings-0.xml")).status).toBe(503);
  });

  test("nothing is cut off: past one file's limit the pages go on in the next", () => {
    const places = Array.from({ length: sitemapLimit + 10 }, (_, index) => ({ state: "lagos", area: `area-${index}`, listings: 5, updated_at: null }));
    const big = sitemap({ places, category_places: [], listing_pages: [] });
    const entries = countryEntries(site, "ng", big);
    expect(entries).toHaveLength(sitemapLimit + 12);
    expect(countryFiles(site, "ng", big).map(item => item.loc)).toEqual([`${site}/sitemaps/ng-pages-0.xml`, `${site}/sitemaps/ng-pages-1.xml`]);
    expect(pagesInFile(entries, 0)).toHaveLength(sitemapLimit);
    expect(pagesInFile(entries, 1)).toHaveLength(12);
  });
});

test("no route is a folder named sitemap.xml under a dynamic segment: Next.js never reaches it in production", () => {
  const app = join(process.cwd(), "app");
  const routes = readdirSync(app, { recursive: true, encoding: "utf8" }).map(path => path.replace(/\\/g, "/")).filter(path => path.endsWith("/route.ts"));
  expect(routes).toContain("sitemap.xml/route.ts");
  const nested = routes.filter(path => path !== "sitemap.xml/route.ts" && /(^|\/)sitemap\.xml\/route\.ts$/.test(path));
  expect(nested).toEqual([]);
});
